const steem = require('steem');
const steemStream = require('steem');
const usernameChecker = require('./utils/username-checker');
const { kebabCase, trim, uniqCompact } = require('./utils/helper');
const { log_errors, request_nodes, stream_nodes } = require('./config');
const { version } = require('./package');

const postingKey = process.env.CHECKY_POSTING_KEY;

steem.api.setOptions({ url: request_nodes[0] });

const comments = [];
// Checking every second if a comment has to be sent and sending it
let commentsInterval = setInterval(() => {
    if(comments[0]) {
        // Making sure that no comment is sent while processing this one
        clearInterval(commentsInterval);
        const comment = comments.shift();
        sendMessage(comment[0], comment[1], comment[2], comment[3], comment[4] || {});
    }
}, 1000);

stream();

/** 
 * Streams operations from the blockchain and calls processCreatedPost or processCommand when necessary
 */
function stream() {
    steemStream.api.setOptions({ url: stream_nodes[0] });
    new Promise((resolve, reject) => {
        console.log('Stream started with', stream_nodes[0]);
        steemStream.api.streamOperations((err, operation) => {
            if(err) return reject(err);
            if(operation) {
                switch(operation[0]) {
                    case 'comment':
                        const author = operation[1].author;
                        const parentAuthor = operation[1].parent_author;
                        const permlink = operation[1].permlink;
    
                        usernameChecker.addUsers(author, parentAuthor);

                        const mode = usernameChecker.getUser(author).mode;
    
                        if(parentAuthor === 'checky') {
                            // Parsing the command from the comment
                            const command = /^(?:^|\(for\s*:\s*@?([A-Za-z0-9.-]+)\))(?:\s*)!([A-Za-z]+)(?:\s+(.+))?/.exec(operation[1].body);
                            if(command) {
                                if(!command[1] || author !== 'ragepeanut') command[1] = author;
                                processCommand(command[2], command[3], command[1], author, permlink, operation[1].parent_permlink);
                            }
                        } else if(parentAuthor === '' && mode !== 'off' || mode === 'advanced') {
                            try {
                                const metadata = JSON.parse(operation[1].json_metadata);
                                if(metadata.tags.every(tag => !/no-?(bot|check)/.test(tag))) processPost(author, permlink, true);
                            } catch(error) {}
                        }
                        break;
                    case 'vote':
                        const voter = operation[1].voter;
                        usernameChecker.addUsers(voter, operation[1].author);
                        // Setting the user mode to off if he has flagged the bot's comment
                        if(operation[1].author === 'checky' && operation[1].weight < 0) usernameChecker.setMode(voter, 'off');
                        break;
                    case 'delegate_vesting_shares':
                        usernameChecker.addUsers(operation[1].delegator, operation[1].delegatee);
                        break;
                    case 'fill_transfer_from_savings':
                    case 'transfer':
                    case 'transfer_to_vesting':
                    case 'transfer_to_savings':
                    case 'transfer_from_savings':
                        usernameChecker.addUsers(operation[1].from, operation[1].to);
                        break;
                    case 'fill_vesting_withdraw':
                        usernameChecker.addUsers(operation[1].from_account, operation[1].to_account);
                        break;
                    case 'account_create':
                    case 'account_create_with_delegation':
                        usernameChecker.addUsers(operation[1].creator, operation[1].new_account_name);
                        break;
                    case 'comment_options':
                    case 'delete_comment':
                        usernameChecker.addUsers(operation[1].author);
                        break;
                }
            }
        });
    }).catch(error => {
        if(log_errors) console.error(`Stream error: ${ error.message } with ${ stream_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        stream_nodes.push(stream_nodes.shift());
        stream();
    });
}

/**
 * Gets the content of a post
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @return {Promise<any>} The content of the post
 */
function getContent(author, permlink) {
    return new Promise(resolve => {
        steem.api.getContent(author, permlink, (err, content) => {
            if(err) {
                if(log_errors) console.error(`Request error (getContent): ${ err.message } with ${ request_nodes[0] }`);
                // Putting the node where the error comes from at the end of the array
                request_nodes.push(request_nodes.shift());
                steem.api.setOptions({ url: request_nodes[0] });
                if(log_errors) console.log(`Retrying with ${ request_nodes[0] }`);
                return resolve(getContent(author, permlink));
            }
            resolve(content);
        });
    })
}

/**
 * Calls processMentions after a certain delay set by the author
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {boolean} mustBeNew Post must be new (true) or can have been updated (false)
 */
function processPost(author, permlink, mustBeNew) {
    getContent(author, permlink)
        .then(content => {
            if(mustBeNew && content.last_update === content.created) {
                const delay = usernameChecker.getUser(author).delay;
                if(delay > 0) {
                    setTimeout(() => { 
                        processPost(author, permlink, false);
                    }, delay * 60 * 1000);
                } else mustBeNew = false;
            }
            if(!mustBeNew) {
                try {
                    const metadata = JSON.parse(content.json_metadata);
                    if(!metadata) throw new Error('The metadata is ' + metadata);
                    if(typeof metadata !== 'object') throw new Error('The metadata isn of type ' + typeof metadata);
                    if(!metadata.tags) throw new Error('The tags property is ' + metadata.tags);
                    if(!Array.isArray(metadata.tags)) throw new Error('The tags property isn\'t an array');
                    if(!metadata.app || typeof metadata.app !== 'string' || !/share2steem/.test(metadata.app)) {
                        processMentions(content.body, author, permlink, content.parent_author === '' ? 'post' : 'comment', metadata.tags);
                    }
                } catch(e) {
                    processMentions(content.body, author, permlink, content.parent_author === '' ? 'post' : 'comment', []);
                }
            }
        });
}

/**
 * Finds all the wrong mentions in the body of a post and calls sendMessage if it finds any
 * @param {string} body The body of the post (used for social network checking)
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {string} type The type of the post (post or comment)
 * @param {string[]} tags The tags of the post
 */
async function processMentions(body, author, permlink, type, tags) {
    let mentions = [];
    const knownUsernames = [];
    const alreadyEncountered = [];
    const details = {};
    const mentionRegex = /(^|[^\w=/])@([a-z][a-z\d.-]{1,16}[a-z\d])(?![\w/(])/gimu;
    // All variations of the author username
    const authorRegex = new RegExp(author.replace(/([a-z]+|\d+)/g, '($1)?').replace(/[.-]/g, '[.-]?'));
    const imageOrDomainRegex = /\.(jpe?g|png|gif|com?|io|org|net|me)$/;
    const ignoredMentions = usernameChecker.getUser(author).ignored;
    let matches = [];
    while(matches = mentionRegex.exec(body)) {
        // If the mention contains adjacent dots, taking only the part before those dots
        const mention = matches[2].split(/\.{2,}/)[0].toLowerCase();
        // Avoiding to repeat the checking for mentions already encountered in the post
        if(!alreadyEncountered.includes(mention)) {
            alreadyEncountered.push(mention);
            const escapedMention = matches[2].replace(/\./g, '\\.');
            const textSurroundingMentionRegex = new RegExp('(?:\\S+\\s+){0,15}\\S*@' + escapedMention + '(?:[^a-z\d]\\S*(?:\\s+\\S+){0,15}|$)', 'gi');
            const mentionInQuoteRegex = new RegExp('^> *.*@' + escapedMention + '.*|<blockquote( +cite="[^"]+")?>((?!<blockquote)[\\s\\S])*@' + escapedMention + '((?!<blockquote)[\\s\\S])*<\\/blockquote>', 'i');
            const mentionInCodeRegex = new RegExp('```[\\s\\S]*@' + escapedMention + '[\\s\\S]*```|`[^`\\r\\n\\f\\v]*@' + escapedMention + '[^`\\r\\n\\f\\v]*`|<code>[\\s\\S]*@' + escapedMention + '[\\s\\S]*<\\/code>', 'i');
            const mentionInLinkedPostTitleRegex = new RegExp('\\[([^\\]]*@' + escapedMention + '[^\\]]*)]\\([^)]*\\/@([a-z][a-z\\d.-]{1,14}[a-z\\d])\\/([a-z0-9-]+)\\)|<a +href="[^"]*\\/@?([a-z][a-z\\d.-]{1,14}[a-z\\d])\\/([a-z0-9-]+)" *>((?:(?!<\\/a>).)*@' + escapedMention + '(?:(?!<\\/a>).)*)<\\/a>', 'i');
            const mentionInImageAltRegex = new RegExp('!\\[[^\\]]*@' + escapedMention + '[^\\]]*]\\([^)]*\\)|<img [^>]*alt="[^"]*@' + escapedMention + '[^"]*"[^>]*>', 'i');
            const socialNetworksRegex = /(insta|tele)gram|tw(it?ter|eet)|facebook|golos|whaleshares?|discord|medium|minds|brunch|unsplash|텔레그램|[^a-z](ig|rt|fb|ws|eos)[^a-z]|t.(me|co)\//i;
            // True if not ignored, not part of a word/url, not a variation of the author username, not in a code block, not in a quote and not ending with an image/domain extension
            if(!ignoredMentions.includes(mention) && mention.match(authorRegex).every(match => !match) && !mentionInCodeRegex.test(body) && !mentionInQuoteRegex.test(body) && !mentionInImageAltRegex.test(body) && !imageOrDomainRegex.test(mention)) {
                // Adding the username to the mentions array only if it doesn't contain a social network reference in the 40 words surrounding it
                const surrounding = body.match(textSurroundingMentionRegex);
                if(surrounding && surrounding.every(text => !socialNetworksRegex.test(text))) {
                    // Adding the username to the mentions array only if it isn't part of the title of a post linked in the checked post
                    const match = body.match(mentionInLinkedPostTitleRegex);
                    if(match) {
                        // Matches are mapped as follows: 1-6 = title    2-4 = author    3-5 = permlink
                        if(kebabCase(match[1] || match[6]) === kebabCase(match[3] || match[5])) continue;
                        const linkedPost = await getContent(match[2] || match[4], match[3] || match[5]);
                        if(linkedPost && kebabCase(match[1] || match[6]) === kebabCase(linkedPost.title)) continue;
                    }
                    details[mention] = (details[mention] || []).concat(
                        surrounding.map(text => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
                                                    .replace(mentionRegex, '$1@<em></em>$2')
                                                    .replace(new RegExp('@<em></em>' + mention, 'gi'), '<strong>$&</strong>')
                                                    .replace(/^ */gm, '> '))
                    );
                    mentions.push(mention);
                }
            }
        }
    }
    if(mentions.length > 0) {
        // Removing existing usernames
        const existingUsernames = await usernameChecker.getExisting(mentions);
        mentions = mentions.filter(mention => {
            if(existingUsernames.includes(mention)) {
                if(mention !== author) knownUsernames.push(mention);
                delete details[mention];
                return false;
            }
            return true;
        });
        // At this point, the mentions array can only contain wrong mentions, building and sending a message if the array is not empty
        if(mentions.length > 0) {
            let message = `Hi @${ author }, I'm @checky ! While checking the mentions made in this ${ type } I noticed that @${ mentions[0] }`;
            const promises = mentions.map(mention => usernameChecker.correct(mention, author, knownUsernames, tags));
            Promise.all(promises)
                .then(suggestions => {
                    usernameChecker.addMentioned(author, knownUsernames);
                    if(mentions.length > 1) {
                        suggestions = uniqCompact(suggestions);
                        let lastSentence = 'Maybe you made some typos';
                        if(suggestions.length > 0) {
                            lastSentence = 'Did you mean to write ' + suggestions[0];
                            if(suggestions.length > 1) {
                                for(let i = 1; i < suggestions.length - 1; i++) {
                                    lastSentence += ', ' + suggestions[i];
                                }
                                lastSentence += ' and ' + suggestions[suggestions.length - 1];
                            }
                        }
                        for(let i = 1; i < mentions.length - 1; i++) {
                            message += ', @' + mentions[i];
                        }
                        message += ` and @${ mentions[mentions.length - 1]} don't exist on Steem. ${ lastSentence } ?`;
                    } else message += ` doesn't exist on Steem. ${ suggestions[0] ? 'Did you mean to write ' + suggestions[0] : 'Maybe you made a typo' } ?`;
                    comments.push([message, author, permlink, 'Possible wrong mentions found', details]);
                });
        }
    } else usernameChecker.addMentioned(author, knownUsernames);
}

/**
 * Processes a command written by a user
 * @param {string} command The command written by the user
 * @param {string} params The command's parameters
 * @param {string} target The user the command applies to
 * @param {string} author The user who wrote the command
 * @param {string} permlink The permlink of the comment in which the command has been written
 * @param {string} parent_permlink The permlink of @checky's comment
 */
async function processCommand(command, params, target, author, permlink, parent_permlink) {
    if(!(await usernameChecker.exists(target))) comments.push(['The target user doesn\'t exist on the Steem blockchain. Maybe you made a typo ?', author, permlink, 'Possible wrong target username']);
    else {
        const targetData = usernameChecker.getUser(target);
        switch(command) {
            case 'ignore':
                if(params) {
                    const mentions = params.split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                    usernameChecker.addIgnored(target, mentions);
                    comments.push([`The following mentions will now be ignored when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky stop ignoring them, reply to any of my posts with \`!unignore username1 username2 ...\`.`, author, permlink, `Added some ignored mentions for @${ target }`]);
                } else comments.push(['You didn\'t specify any username to ignore. Please try again by using the format `!ignore username1 username2`.', author, permlink, 'No username specified']);
                break;
            case 'unignore':
                if(params) {
                    const mentions = params.split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                    usernameChecker.removeIgnored(target, mentions);
                    comments.push([`The following mentions will now be checked by @checky when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky start ignoring them again, reply to any of my posts with \`!ignore username1 username2 ...\`.`, author, permlink, `Removed some ignored mentions for @${ target }`]);
                } else comments.push(['You didn\'t specify any username to unignore. Please try again by using the format `!unignore username1 username2`.', author, permlink, 'No username specified']);
                break;
            // Shortcuts for !mode [on-off]
            case 'on':
            case 'off':
                params = command;
            case 'mode':
            case 'switch':
                if(params) {
                    // Removing white spaces arround the parameter
                    const mode = trim(params);
                    switch(mode) {
                        case 'on':
                        case 'regular':
                        case 'normal':
                            usernameChecker.setMode(target, 'regular');
                            comments.push(['Your account has been set to regular. You will now only get your mentions checked for posts you make.', author, permlink, 'Account set to regular']);
                            break;
                        case 'advanced':
                        case 'plus':
                            usernameChecker.setMode(target, 'advanced');
                            comments.push(['Your account has been set to advanced. You will now get your mentions checked for posts and comments you make.', author, permlink, 'Account set to advanced']);
                            break;
                        case 'off':
                            usernameChecker.setMode(target, 'off');
                            comments.push(['Your account has been set to off. None of your mentions will now be checked whatsoever.', author, permlink, 'Account set to off']);
                            break;
                        default:
                            comments.push([`The ${ mode } mode doesn't exist. Your account is currently set to ${ targetData.mode }. To switch it to regular, advanced or off, please write \`!mode [regular-advanced-off]\`.`, author, permlink, 'Wrong mode specified']);
                    }
                } else comments.push([`You didn't spectify any mode to switch to. Please try again by using \`!${ command } regular\`, \`!${ command } advanced\` or \`!${ command } off\`.`, author, permlink, 'No mode specified']);
                break;
            case 'state':
                let ignored = 'No mentions are being ignored by @checky';
                if(targetData.ignored.length > 0) ignored = 'The following mentions are being ignored by @checky: ' + targetData.ignored.join(', ');
                comments.push([`Your account is currently set to ${ targetData.mode }. Your posts are being checked ${ targetData.delay } minute${ targetData.delay !== 1 ? 's' : '' } after being posted. ${ ignored }.`, author, permlink, 'Account state']);
                break;
            case 'wait':
            case 'delay':
                if(params) {
                    const delay = parseInt(params);
                    if(usernameChecker.setDelay(Math.abs(delay))) {
                        if(targetData.delay > 0 ) comments.push([`The delay has been set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }. @checky will now wait ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' } before checking your mentions.`, author, permlink, `Delay set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }`]);
                        else comments.push([`The delay has been set to ${ targetData.delay } minutes. @checky will instantly check your mentions when you post.`, author, permlink, `Delay set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }`])
                    } else comments.push(['You didn\'t correctly specify the delay. Please try again by using a number to represent the delay.', author, permlink, `Delay wrongly specified`]);
                } else comments.push([`You didn't specify the delay. Please try again by using \`!${ command } minutes`, author, permlink, 'No delay specified']);
                break;
            case 'surrounding':
            case 'details':
                const content = await getContent('checky', parent_permlink);
                let details;
                try {
                    details = JSON.parse(content.json_metadata).details;
                } catch(e) {
                    details = null;
                }
                if(!details || Object.keys(details).length === 0) comments.push(['You can only use this command under @checky\'s suggestion comments.', author, permlink, 'Details unreachable']);
                else {
                    const detailsKeys = Object.keys(details);
                    const mentions = params ? params.split(/[\s,]+/).filter(param => detailsKeys.includes(param)) : detailsKeys;
                    if(mentions.length === 0) comments.push(['You didn\'t specify any wrong mention.', author, permlink, 'No wrong mention specified']);
                    else {
                        let message = 'Here are the details you requested:';
                        mentions.forEach(mention => {
                            message += '\n\n**@<em></em>' + mention + '**';
                            details.mention.forEach(surrounding => message += '\n\n' + surrounding);
                        });
                        comments.push([message, author, permlink, 'Details']);
                    }
                }
                break;
            case 'help':
                const message = '#### Here are all the available commands:\n* **!delay** *minutes* **-** tells the bot to wait X minutes before checking your posts.\n* **!help** **-** gives a list of commands and their explanations.\n* **!ignore** *username1* *username2* **-** tells the bot to ignore some usernames mentioned in your posts (useful to avoid the bot mistaking other social network accounts for Steem accounts).\n* **!mode** *[regular-advanced-off]* **-** sets the mentions checking to regular (only posts), advanced (posts and comments) or off (no checking). Alternatively, you can write *normal* or *on* instead of *regular*. You can also write *plus* instead of *advanced*.\n* **!off** **-** shortcut for **!mode off**.\n* **!on** **-** shortcut for **!mode on**.\n* **!state** **-** gives the state of your account (*regular*, *advanced* or *off*).\n* **!switch** *[regular-advanced-off]* **-** same as **!mode**.\n* **!unignore** *username1* *username2* **-** tells the bot to unignore some usernames mentioned in your posts.\n* **!wait** *minutes* - same as **!delay**.\n\n###### Any idea on how to improve this bot ? Please contact @ragepeanut on any of his posts or send him a direct message on Discord (RagePeanut#8078).';
                comments.push([message, author, permlink, 'Commands list']);
                break;
            default:
                comments.push(['This command doesn\'t exist.', author, permlink, 'Unknown command']);
        }
    }
}

/**
 * Broadcasts a comment on a post containing wrong mentions
 * @param {string} message The message to broadcast
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {string} title The title of the message to broadcast
 * @param {any} details The details about where the wrong mentions have been found
 */
function sendMessage(message, author, permlink, title, details) {
    if(title.length > 255) title = title.slice(0, 252) + '...';
    const metadata = {
        app: 'checky/' + version,
        details,
        format: 'markdown',
        tags: [ 
            'mentions',
            'bot',
            'checky'
        ]
    }
    const footer = '\n\n###### If you found this comment useful, consider upvoting it to help keep this bot running. You can see a list of all available commands by replying with `!help`.';
    steem.broadcast.comment(postingKey, author, permlink, 'checky', 're-' + author.replace(/\./g, '') + '-' + permlink, title, message + footer, JSON.stringify(metadata), function(err) {
        if(err) {
            if(log_errors) console.error(`Broadcast error: ${ err.message } with ${ request_nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            request_nodes.push(request_nodes.shift());
            steem.api.setOptions({ url: request_nodes[0] });
            if(log_errors) console.log(`Retrying with ${ request_nodes[0] }`);
            sendMessage(message, author, permlink, title);
        } else {
            // Making sure that the 20 seconds delay between comments is respected
            setTimeout(() => {
                commentsInterval = setInterval(() => {
                    if(comments[0]) {
                        // Making sure that no comment is sent while processing this one
                        clearInterval(commentsInterval);
                        const comment = comments.shift();
                        sendMessage(comment[0], comment[1], comment[2], comment[3]);
                    }
                }, 1000);
            }, 19000);
        }
    });
}
