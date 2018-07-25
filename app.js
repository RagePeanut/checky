const _ = require('lodash');
const steem = require('steem');
const steemStream = require('steem');
const usernameChecker = require('./username-checker');
const { request_nodes, stream_nodes } = require('./config');

const postingKey = process.env.CHECKY_POSTING_KEY;

steem.api.setOptions({ url: request_nodes[0] });

const comments = [];
// Checking every second if a comment has to be sent and sending it
let commentsInterval = setInterval(() => {
    if(comments[0]) {
        // Making sure that no comment is sent while processing this one
        clearInterval(commentsInterval);
        const comment = comments.shift();
        sendMessage(comment[0], comment[1], comment[2], comment[3]);
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
                        const body = operation[1].body;
                        const permlink = operation[1].permlink;
    
                        usernameChecker.addUsers(author, parentAuthor);

                        const mode = usernameChecker.getUser(author).mode;
    
                        if(parentAuthor === 'checky') {
                            // Parsing the command from the comment
                            const command = /^(?:^|\(for\s*:\s*@?([A-Za-z0-9.-]+)\))(?:\s*)!([A-Za-z]+)(?:\s+(.+))?/.exec(body);
                            if(command) {
                                if(!command[1] || author !== 'ragepeanut') command[1] = author;
                                processCommand(command[2], command[3], command[1], author, permlink);
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
                    case 'escrow_release':
                        usernameChecker.addUsers(operation[1].from, operation[1].to, operation[1].agent, operation[1].who, operation[1].receiver);
                        break;
                    case 'escrow_approve':
                    case 'escrow_dispute':
                        usernameChecker.addUsers(operation[1].from, operation[1].to, operation[1].agent, operation[1].who);
                        break;
                    case 'escrow_transfer':
                        usernameChecker.addUsers(operation[1].from, operation[1].to, operation[1].agent);
                        break;
                    case 'fill_transfer_from_savings':
                    case 'transfer':
                    case 'transfer_to_vesting':
                    case 'transfer_to_savings':
                    case 'transfer_from_savings':
                        usernameChecker.addUsers(operation[1].from, operation[1].to);
                        break;
                    case 'fill_vesting_withdraw':
                    case 'set_withdraw_vesting_route':
                        usernameChecker.addUsers(operation[1].from_account, operation[1].to_account);
                        break;
                    case 'fill_order':
                        usernameChecker.addUsers(operation[1].current_owner, operation[1].open_owner);
                        break;
                    case 'request_account_recovery':
                        usernameChecker.addUsers(operation[1].recovery_account, operation[1].account_to_recover);
                        break;
                    case 'change_recovery_account':
                        usernameChecker.addUsers(operation[1].account_to_recover, operation[1].new_recovery_account);
                        break;
                    case 'account_create':
                    case 'account_create_with_delegation':
                        usernameChecker.addUsers(operation[1].creator, operation[1].new_account_name);
                        break;
                    case 'account_witness_vote':
                        usernameChecker.addUsers(operation[1].account, operation[1].witness);
                        break;
                    case 'account_witness_proxy':
                        usernameChecker.addUsers(operation[1].account, operation[1].proxy);
                        break;
                    case 'account_update':
                    case 'claim_reward_balance':
                    case 'decline_voting_rights':
                    case 'return_vesting_delegation':
                    case 'withdraw_vesting':
                        usernameChecker.addUsers(operation[1].account);
                        break;
                    case 'convert': 
                    case 'fill_convert_request':
                    case 'interest':
                    case 'limit_order_create':
                    case 'limit_order_create2':
                    case 'limit_order_cancel':
                    case 'liquidity_reward':
                    case 'shutdown_witness':
                    case 'witness_update':
                        usernameChecker.addUsers(operation[1].owner);
                        break;
                    case 'author_reward':
                    case 'comment_options':
                    case 'comment_payout_update':
                    case 'comment_reward':
                    case 'delete_comment':
                        usernameChecker.addUsers(operation[1].author);
                        break;
                    case 'curation_reward':
                        usernameChecker.addUsers(operation[1].curator, operation[1].comment_author);
                        break;
                    case 'feed_publish':
                        usernameChecker.addUsers(operation[1].publisher);
                        break;
                    case 'recover_account':
                        usernameChecker.addUsers(operation[1].account_to_recover);
                        break;
                    case 'cancel_transfer_from_savings':
                        usernameChecker.addUsers(operation[1].from);
                        break;
                    case 'comment_benefactor_reward':
                        usernameChecker.addUsers(operation[1].benefactor, operation[1].author);
                        break;
                    case 'producer_reward':
                        usernameChecker.addUsers(operation[1].producer);
                        break;
                    case 'prove_authority':
                        usernameChecker.addUsers(operation[1].challenged);
                }
            }
        });
    }).catch(error => {
        console.error(`Stream error: ${ error.message } with ${ stream_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        stream_nodes.push(stream_nodes.shift());
        stream();
    });
}

/**
 * Checks that the comment operation is for a new post and calls processMentions
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {boolean} mustBeNew Post must be new (true) or can have been updated (false)
 */
function processPost(author, permlink, mustBeNew) {
    steem.api.getContent(author, permlink, (err, res) => {
        if(err) {
            console.error(`Request error (getContent): ${ err.message } with ${ request_nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            request_nodes.push(request_nodes.shift());
            steem.api.setOptions({ url: request_nodes[0] });
            console.log(`Retrying with ${ request_nodes[0] }`);
            processPost(author, permlink, mustBeNew);
        } else {
            if(mustBeNew && res.last_update === res.created) {
                const delay = usernameChecker.getUser(author).delay;
                if(delay > 0) {
                    setTimeout(() => { 
                        processPost(author, permlink, false);
                    }, delay * 60 * 1000);
                } else mustBeNew = false;
            }
            if(!mustBeNew) processMentions(res.body, author, permlink, res.title, res.parent_author === '' ? 'post' : 'comment');
        }
    });
}

/**
 * Finds all the wrong mentions in the body of a post and calls sendMessage if it finds any
 * @param {string} body The body of the post (used for social network checking)
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {string} title The title of the post
 * @param {string} type The type of the post (post or comment)
 * @param {string[]} mentions An array of already found mentions (optional)
 */
function processMentions(body, author, permlink, title, type, mentions) {
    const knownUsernames = [];
    if(!mentions) {
        const regex = /(?:^|[^\w=/])@([a-z][a-z\d.-]{1,16}[a-z\d])(.|$)/gimu;
        let matches = [];
        mentions = [];
        while(matches = regex.exec(body)) {
            if(!/[\w/(]/.test(matches[2])) {
                // Pushing mentions, if they contain adjacent dots --> pushing only the part before those dots
                mentions.push(matches[1].split(/\.{2,}/)[0].toLowerCase());
            }
        }
        // Removing duplicates and already encountered users
        mentions = _.uniq(mentions).filter(mention => {
            if(usernameChecker.isKnown(mention)) {
                if(mention !== author) knownUsernames.push(mention);
                return false;
            }
            return true;
        });
        // Removing all variations of the author username
        const authorRegex = new RegExp(author.replace(/([a-z]+|\d+)/g, '($1)?').replace(/[.-]/g, '[.-]?'));
        mentions = mentions.filter(mention => {
            return mention.match(authorRegex).every(match => match === undefined || match === '');
        });
        // Removing images and popular domain extensions
        mentions = mentions.filter(mention => !/\.(jpe?g|png|gif|com?|io|org|net)$/.test(mention));
        // Removing ignored mentions
        const ignoredMentions = usernameChecker.getUser(author).ignored;
        if(ignoredMentions.length > 0) mentions = mentions.filter(mention => !ignoredMentions.includes(mention));
    }
    if(mentions.length > 0) {
        steem.api.lookupAccountNames(mentions, (err, res) => {
            if(err) {
                console.error(`Request error (lookupAccountNames): ${ err.message } with ${ request_nodes[0] }`);
                // Putting the node where the error comes from at the end of the array
                request_nodes.push(request_nodes.shift());
                steem.api.setOptions({ url: request_nodes[0] });
                console.log(`Retrying with ${ request_nodes[0] }`);
                processMentions(body, author, permlink, title, type, mentions);
            } else {
                let wrongMentions = [];
                // Adding each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
                for(let i = 0; i < mentions.length; i++) {
                    if(res[i] === null) {
                        // Adding the username to the wrongMentions array only if it doesn't contain a social network reference in the 40 words surrounding it
                        const match = body.match(new RegExp('(?:\\S+\\s+){0,20}\\S*@' + _.escapeRegExp(mentions[i]) + '\\S*(?:\\s+\\S+){0,20}', 'i'));
                        if(match && !/(insta|tele)gram|tw(it?ter|eet)|facebook|golos|discord|medium|minds|brunch|텔레그램|[^a-z](ig|rt|fb|eos|t.(me|co)\/)[^a-z]/i.test(match[0])) wrongMentions.push(mentions[i]);
                    } else {
                        usernameChecker.addUsers(author, mentions[i]);
                        knownUsernames.push(mentions[i]);
                    }
                }
                // Building and sending a message if any wrong mention has been found in the post/comment
                if(wrongMentions.length > 0) {
                    let message = `Hi @${ author }, I'm @checky ! While checking the mentions made in this ${ type } I noticed that @${ wrongMentions[0] }`;
                    const promises = wrongMentions.map(mention => usernameChecker.correct(mention, author, knownUsernames));
                    Promise.all(promises)
                           .then((suggestions) => {
                                if(wrongMentions.length > 1) {
                                    suggestions = _.uniq(_.compact(suggestions));
                                    let lastSentence = 'Maybe you made some typos';
                                    if(suggestions.length > 0) {
                                        lastSentence = 'Did you mean to write @<em></em>' + suggestions[0];
                                        if(suggestions.length > 1) {
                                            for(let i = 1; i < suggestions.length - 1; i++) {
                                                lastSentence += ', @<em></em>' + suggestions[i];
                                            }
                                            lastSentence += ' and @<em></em>' + suggestions[suggestions.length - 1];
                                        }
                                    }
                                    for(let i = 1; i < wrongMentions.length - 1; i++) {
                                        message += ', @' + wrongMentions[i];
                                    }
                                    message += ` and @${ wrongMentions[wrongMentions.length - 1]} don't exist on Steem. ${ lastSentence } ?`;
                                } else message += ` doesn't exist on Steem. ${ suggestions[0] ? 'Did you mean to write @<em></em>' + suggestions[0] : 'Maybe you made a typo' } ?`;
                                comments.push([message, author, permlink, 'Possible wrong mentions found in ' + title]);
                           });
                }
            }
        });
    }
    usernameChecker.addMentioned(author, knownUsernames);
}

/**
 * Processes a command written by a user
 * @param {string} command The command written by the user
 * @param {string} params The command's parameters
 * @param {string} target The user the command applies to
 * @param {string} author The user who wrote the command
 * @param {string} permlink The permlink of the comment in which the command has been written
 */
function processCommand(command, params, target, author, permlink) {
    if(!usernameChecker.isKnown(target)) comments.push(['The target user doesn\'t exist on the Steem blockchain. Maybe you made a typo ?', author, permlink, 'Possible wrong target username']);
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
                    const mode = _.trim(params);
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
 */
function sendMessage(message, author, permlink, title) {
    const metadata = {
        app: 'checky/0.1.0',
        format: 'markdown',
        tags: [ 
            'mentions',
            'bot',
            'checky'
        ]
    }
    const footer = '\n\n###### If you found this comment useful, consider upvoting it to help keep this bot running. You can see a list of all available commands by replying with `!help`.';
    steem.broadcast.comment(postingKey, author, permlink, 'checky', 're-' + author.replace('.', '') + '-' + permlink, title, message + footer, JSON.stringify(metadata), function(err) {
        if(err) {
            console.error(`Broadcast error: ${ err.message } with ${ request_nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            request_nodes.push(request_nodes.shift());
            steem.api.setOptions({ url: request_nodes[0] });
            console.log(`Retrying with ${ request_nodes[0] }`);
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
