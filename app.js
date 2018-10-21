const steem = require('steem');
const steemer = require('./utils/steemer');
const checker = require('./utils/checker');
checker.init(steemer);
const upvoter = require('./utils/upvoter');
upvoter.init(steemer);
const { kebabCase, trim, uniqCompact } = require('./utils/helper');
const { fail_safe_node, log_errors, test_environment} = require('./config');
const { version } = require('./package');

const comments = [];
// Checking every second if a comment has to be sent and sending it
let commentsInterval = setInterval(prepareComment, 1000);

let alreadyStreaming = false;
let nodes = [fail_safe_node];
steemer.updateNodes(newNodes => {
    nodes = newNodes;
    if(!alreadyStreaming) {
        alreadyStreaming = true;
        stream();
    }
});

/** 
 * Streams operations from the blockchain and calls processCreatedPost or processCommand when necessary
 */
function stream() {
    steem.api.setOptions({ url: nodes[0] });
    new Promise((_, reject) => {
        console.log('Stream started with', nodes[0]);
        steem.api.streamOperations((err, operation) => {
            if(err) return reject(err);
            if(operation) {
                switch(operation[0]) {
                    case 'comment':
                        const author = operation[1].author;
                        const parentAuthor = operation[1].parent_author;
                        const permlink = operation[1].permlink;
    
                        checker.addUsers(author, parentAuthor);

                        const mode = checker.getUser(author).mode;
    
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
                        checker.addUsers(voter, operation[1].author);
                        // Setting the user mode to off if he has flagged the bot's comment
                        if(operation[1].author === 'checky' && operation[1].weight < 0) checker.setMode(voter, 'off');
                        break;
                    case 'delegate_vesting_shares':
                        checker.addUsers(operation[1].delegator, operation[1].delegatee);
                        break;
                    case 'fill_transfer_from_savings':
                    case 'transfer':
                    case 'transfer_to_vesting':
                    case 'transfer_to_savings':
                    case 'transfer_from_savings':
                        checker.addUsers(operation[1].from, operation[1].to);
                        break;
                    case 'fill_vesting_withdraw':
                        checker.addUsers(operation[1].from_account, operation[1].to_account);
                        break;
                    case 'account_create':
                    case 'account_create_with_delegation':
                        checker.addUsers(operation[1].creator, operation[1].new_account_name);
                        break;
                    case 'comment_options':
                    case 'delete_comment':
                        checker.addUsers(operation[1].author);
                        break;
                }
            }
        });
    }).catch(error => {
        if(log_errors) console.error(`Stream error: ${ error.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        stream();
    });
}

/**
 * Builds a message with suggested corrections based on the wrong mentions found in a post
 * @param {string[]} wrongMentions The wrong mentions found in the post
 * @param {string[]} correctMentions The correct mentions found in the post
 * @param {string} author The author of the post
 * @param {string} type The type of the post (post or comment)
 * @param {string[]} tags The tags of the post
 */
async function buildMessage(wrongMentions, correctMentions, author, type, tags) {
    let message = `Hi @${ author }, I'm @checky ! While checking the mentions made in this ${ type } I noticed that @${ wrongMentions[0] }`;
    const promises = wrongMentions.map(mention => checker.correct(mention, author, correctMentions, tags));
    let suggestions = await Promise.all(promises);
    if(wrongMentions.length > 1) {
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
        for(let i = 1; i < wrongMentions.length - 1; i++) {
            message += ', @' + wrongMentions[i];
        }
        message += ` and @${ wrongMentions[wrongMentions.length - 1]} don't exist on Steem. ${ lastSentence } ?`;
    } else message += ` doesn't exist on Steem. ${ suggestions[0] ? 'Did you mean to write ' + suggestions[0] : 'Maybe you made a typo' } ?`;
    return message;
}

/**
 * Finds all the wrong mentions in the body of a post
 * @param {string} body The body of the post (used for social network checking)
 * @param {string} author The author of the post
 * @param {string[]} tags The tags of the post
 * @returns {Promise<{details:any,wrongMentions:string[], correctMentions:string[]}>} The wrong mentions found, the details on their surroundings and the correct mentions
 */
async function findWrongMentions(body, author, tags) {
    let wrongMentions = [];
    const correctMentions = [];
    const alreadyEncountered = [];
    const details = {};
    const mentionRegex = /(^|[^\w=/#])@([a-z][a-z\d.-]{1,16}[a-z\d])([\w(]|\.[a-z])?/gmu;
    // All variations of the author username
    const authorRegex = new RegExp(author.replace(/([a-z]+|\d+)/g, '($1)?').replace(/[.-]/g, '[.-]?'));
    const imageOrDomainRegex = /\.(jpe?g|png|gif|com?|io|org|net|me)$/;
    const ignoredMentions = checker.getUser(author).ignored;
    let matches = [];
    while(matches = mentionRegex.exec(body)) {
        // Checking if an illegal character comes just after the mention
        if(!matches[3]) {
            // If the mention contains adjacent dots, taking only the part before those dots
            const mention = matches[2].split(/\.{2,}/)[0].toLowerCase();
            // Avoiding to repeat the checking for mentions already encountered in the post
            if(!alreadyEncountered.includes(mention)) {
                alreadyEncountered.push(mention);
                const escapedMention = mention.replace(/\./g, '\\.');
                const textSurroundingMentionRegex = new RegExp('(?:\\S+\\s+){0,15}\\S*@' + escapedMention + '(?:[^a-z\d]\\S*(?:\\s+\\S+){0,15}|$)', 'gi');
                const mentionInQuoteRegex = new RegExp('^(> *| {4}).*@' + escapedMention + '.*|<blockquote( +cite="[^"]+")?>((?!<blockquote)[\\s\\S])*@' + escapedMention + '((?!<blockquote)[\\s\\S])*<\\/blockquote>', 'im');
                const mentionInCodeRegex = new RegExp('```[\\s\\S]*@' + escapedMention + '[\\s\\S]*```|`[^`\\r\\n\\f\\v]*@' + escapedMention + '[^`\\r\\n\\f\\v]*`|<code>[\\s\\S]*@' + escapedMention + '[\\s\\S]*<\\/code>', 'i');
                const mentionInLinkedPostTitleRegex = new RegExp('\\[([^\\]]*@' + escapedMention + '[^\\]]*)]\\([^)]*\\/@([a-z][a-z\\d.-]{1,14}[a-z\\d])\\/([a-z0-9-]+)\\)|<a +href="[^"]*\\/@?([a-z][a-z\\d.-]{1,14}[a-z\\d])\\/([a-z0-9-]+)" *>((?:(?!<\\/a>).)*@' + escapedMention + '(?:(?!<\\/a>).)*)<\\/a>', 'i');
                const mentionInImageAltRegex = new RegExp('!\\[[^\\]]*@' + escapedMention + '[^\\]]*]\\([^)]*\\)|<img [^>]*alt="[^"]*@' + escapedMention + '[^"]*"[^>]*>', 'i');
                const socialNetworksRegex = /(insta|tele)gram|tw(it?ter|eet)|facebook|golos|weku|whaleshares?|discord|medium|minds|brunch|unsplash|텔레그램|推特|[^a-z.](ig|rt|fb|ws|eos)[^a-z.]|t.(me|co)\//i;
                // True if not ignored, not part of a word/url, not a variation of the author username, not in a code block, not in a quote and not ending with an image/domain extension
                if(!ignoredMentions.includes(mention) && !tags.some(tag => tag === 'whaleshares') && mention.match(authorRegex).every(match => !match) && !mentionInCodeRegex.test(body) && !mentionInQuoteRegex.test(body) && !mentionInImageAltRegex.test(body) && !imageOrDomainRegex.test(mention)) {
                    // Adding the username to the mentions array only if it doesn't contain a social network reference in the 30 words surrounding it
                    const surrounding = body.match(textSurroundingMentionRegex);
                    if(surrounding && surrounding.every(text => !socialNetworksRegex.test(text))) {
                        // Adding the username to the mentions array only if it isn't part of the title of a post linked in the checked post
                        const match = body.match(mentionInLinkedPostTitleRegex);
                        if(match) {
                            // Matches are mapped as follows: 1-6 = title    2-4 = author    3-5 = permlink
                            if(kebabCase(match[1] || match[6]) === kebabCase(match[3] || match[5])) continue;
                            const linkedPost = await steemer.getContent(match[2] || match[4], match[3] || match[5]);
                            if(linkedPost && kebabCase(match[1] || match[6]) === kebabCase(linkedPost.title)) continue;
                        }
                        details[mention] = (details[mention] || []).concat(
                            surrounding.map(text => text.replace(/!\[[^\]]*\]\([^)]*\)|<img [^>]+>/g, '')
                                                        .replace(mentionRegex, '$1@<em></em>$2')
                                                        .replace(new RegExp('(@<em></em>' + mention + ')([\\w(]|\\.[a-z])?', 'g'), '<strong>$1</strong>$2')
                                                        .replace(/^ */gm, '> '))
                        );
                        wrongMentions.push(mention);
                    }
                }
            }
        }
    }
    if(wrongMentions.length > 0) {
        // Removing existing usernames
        const existingUsernames = await checker.getExisting(wrongMentions);
        wrongMentions = wrongMentions.filter(mention => {
            if(existingUsernames.includes(mention)) {
                if(mention !== author) correctMentions.push(mention);
                delete details[mention];
                return false;
            }
            return true;
        });
    }
    checker.addMentioned(author, correctMentions);
    return { details, wrongMentions, correctMentions };
}

/**
 * Prepares a comment and makes sure that no comment is being sent before this one
 */
function prepareComment() {
    if(comments[0]) {
        // Making sure that no comment is sent while processing this one
        clearInterval(commentsInterval);
        const comment = comments.shift();
        sendComment(comment[0], comment[1], comment[2], comment[3], comment[4] || {});
    }
}

/**
 * Calls processMentions after a certain delay set by the author
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {boolean} mustBeNew Post must be new (true) or can have been updated (false)
 */
async function processPost(author, permlink, mustBeNew) {
    const content = await steemer.getContent(author, permlink);
    if(mustBeNew && content.last_update === content.created) {
        const delay = checker.getUser(author).delay;
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
                const { details, wrongMentions, correctMentions } = await findWrongMentions(content.body, author, metadata.tags);
                if(wrongMentions.length > 0) {
                    const message = await buildMessage(wrongMentions, correctMentions, author, content.parent_author === '' ? 'post' : 'comment', metadata.tags);
                    comments.push([message, author, permlink, 'Possible wrong mentions found', details]);
                }
            }
        } catch(e) {
            const { details, wrongMentions, correctMentions } = await findWrongMentions(content.body, author, []);
            if(wrongMentions.length > 0) {
                const message = await buildMessage(wrongMentions, correctMentions, author, content.parent_author === '' ? 'post' : 'comment', []);
                comments.push([message, author, permlink, 'Possible wrong mentions found', details]);
            }
        }
    }
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
    if(!(await checker.exists(target))) comments.push(['The target user doesn\'t exist on the Steem blockchain. Maybe you made a typo ?', author, permlink, 'Possible wrong target username']);
    else {
        const targetData = checker.getUser(target);
        switch(command) {
            case 'ignore':
                if(params) {
                    const mentions = params.split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                    checker.addIgnored(target, mentions);
                    comments.push([`The following mentions will now be ignored when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky stop ignoring them, reply to any of my posts with \`!unignore username1 username2 ...\`.`, author, permlink, `Added some ignored mentions for @${ target }`]);
                } else comments.push(['You didn\'t specify any username to ignore. Please try again by using the format `!ignore username1 username2`.', author, permlink, 'No username specified']);
                break;
            case 'unignore':
                if(params) {
                    const mentions = params.split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                    checker.removeIgnored(target, mentions);
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
                            checker.setMode(target, 'regular');
                            comments.push(['Your account has been set to regular. You will now only get your mentions checked for posts you make.', author, permlink, 'Account set to regular']);
                            break;
                        case 'advanced':
                        case 'plus':
                            checker.setMode(target, 'advanced');
                            comments.push(['Your account has been set to advanced. You will now get your mentions checked for posts and comments you make.', author, permlink, 'Account set to advanced']);
                            break;
                        case 'off':
                            checker.setMode(target, 'off');
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
                    if(checker.setDelay(target, Math.abs(delay))) {
                        if(targetData.delay > 0 ) comments.push([`The delay has been set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }. @checky will now wait ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' } before checking your mentions.`, author, permlink, `Delay set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }`]);
                        else comments.push([`The delay has been set to ${ targetData.delay } minutes. @checky will instantly check your mentions when you post.`, author, permlink, `Delay set to ${ targetData.delay } minute${ targetData.delay > 1 ? 's' : '' }`])
                    } else comments.push(['You didn\'t correctly specify the delay. Please try again by using a number to represent the delay.', author, permlink, `Delay wrongly specified`]);
                } else comments.push([`You didn't specify the delay. Please try again by using \`!${ command } minutes`, author, permlink, 'No delay specified']);
                break;
            case 'where':
                const content = await steemer.getContent('checky', parent_permlink);
                let details;
                try {
                    details = JSON.parse(content.json_metadata).details;
                } catch(e) {
                    details = null;
                }
                if(!details || Object.keys(details).length === 0) comments.push(['You can only use this command under @checky\'s suggestion comments.', author, permlink, 'Details unreachable']);
                else {
                    const detailsKeys = Object.keys(details);
                    const mentions = params ? params.split(/[\s,]+/).filter(param => detailsKeys.includes(param)).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase()) : detailsKeys;
                    if(mentions.length === 0) comments.push(['You didn\'t specify any wrong mention. This command\'s parameters must be the mentions as you typed them in your original post, not their corrections.', author, permlink, 'No wrong mention specified']);
                    else {
                        let message = '';
                        mentions.forEach(mention => {
                            message += 'The mention **@<em></em>' + mention + '** has been detected in this part of the post:\n';
                            details[mention].forEach(surrounding => message += surrounding + '\n\n');
                        });
                        comments.push([message, author, permlink, 'Details']);
                    }
                }
                break;
            case 'help':
                const message = '#### Here are all the available commands:\n* **!delay** *minutes* **-** tells the bot to wait X minutes before checking your posts.\n* **!help** **-** gives a list of commands and their explanations.\n* **!ignore** *username1* *username2* **-** tells the bot to ignore some usernames mentioned in your posts (useful to avoid the bot mistaking other social network accounts for Steem accounts).\n* **!mode** *[regular-advanced-off]* **-** sets the mentions checking to regular (only posts), advanced (posts and comments) or off (no checking). Alternatively, you can write *normal* or *on* instead of *regular*. You can also write *plus* instead of *advanced*.\n* **!off** **-** shortcut for **!mode off**.\n* **!on** **-** shortcut for **!mode on**.\n* **!state** **-** gives the state of your account (*regular*, *advanced* or *off*).\n* **!switch** *[regular-advanced-off]* **-** same as **!mode**.\n* **!unignore** *username1* *username2* **-** tells the bot to unignore some usernames mentioned in your posts.\n* **!wait** *minutes* **-** same as **!delay**.\n* **!where** *username1* *username2* **-** asks the bot to show where in the post it found typos for the specified mentions. Alternatively, you can write this command with no parameters and it will show you where it found all the mentions with typos in them.\n\n###### Any idea on how to improve this bot ? Please contact @ragepeanut on any of his posts or send him a direct message on Discord (RagePeanut#8078).';
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
 * @param {string} author The author of the post to reply to
 * @param {string} permlink The permlink of the post to reply to
 * @param {string} title The title of the comment to broadcast
 * @param {any} details The details about where the wrong mentions have been found
 */
async function sendComment(message, author, permlink, title, details) {
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
    if(test_environment) console.log(author, permlink, message, details);
    else await steemer.broadcastComment(author, permlink, 'checky', 're-' + author.replace(/\./g, '') + '-' + permlink, title, message + footer, JSON.stringify(metadata));
    // Making sure that the 20 seconds delay between comments is respected
    setTimeout(() => {
        commentsInterval = setInterval(prepareComment, 1000)
    }, 19000);
    // Adding the post to the upvote candidates if the wrong mentions have been edited in the day following @checky's comment
    setTimeout(async () => {
        const content = await steemer.getContent(author, permlink);
        const { wrongMentions } = await findWrongMentions(content.body, author, []);
        if(wrongMentions.length === 0) upvoter.addCandidate(author, permlink);
    }, test_environment ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000); // 15 minutes in test environment, 24 hours in production environment
}
