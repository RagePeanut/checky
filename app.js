const _ = require('lodash');
const fs = require('fs');
const steem = require('steem');
const steemStream = require('steem');
const { request_nodes, stream_nodes } = require('./config');

const postingKey = process.env.CHECKY_POSTING_KEY;

steem.api.setOptions({ url: request_nodes[0] });

// Creating a users object and updating it with the content of ./data/users.json if the file exists 
let users = {};
if(fs.existsSync('data') && fs.existsSync('data/users.json')) users = require('./data/users');
else fs.mkdirSync('data');

// Updating the ./data/users.json file with the content of the users object every 5 seconds
setInterval(() => 
    fs.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err) console.error(err.message);
    })
, 5 * 1000);

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
    
                        addUsers(author, parentAuthor);
    
                        if(parentAuthor === 'checky') {
                            // Parsing the command from the comment
                            const command = /^(?:\s*)!([A-Za-z]+)(?:\s+(.+))?/.exec(body);
                            if(command) processCommand(command, author, permlink);
                        } else if(parentAuthor === '' && users[author].mode !== 'off' || users[author].mode === 'advanced') {
                            processPost(body, author, permlink, true);
                        }
                        break;
                    case 'vote':
                        const voter = operation[1].voter;
                        addUsers(voter, operation[1].author);
                        // Setting the user mode to off if he has flagged the bot's comment
                        if(operation[1].author === 'checky' && operation[1].weight < 0) users[voter].mode = 'off';
                        break;
                    case 'delegate_vesting_shares':
                        addUsers(operation[1].delegator, operation[1].delegatee);
                        break;
                    case 'escrow_release':
                        addUsers(operation[1].from, operation[1].to, operation[1].agent, operation[1].who, operation[1].receiver);
                        break;
                    case 'escrow_approve':
                    case 'escrow_dispute':
                        addUsers(operation[1].from, operation[1].to, operation[1].agent, operation[1].who);
                        break;
                    case 'escrow_transfer':
                        addUsers(operation[1].from, operation[1].to, operation[1].agent);
                        break;
                    case 'fill_transfer_from_savings':
                    case 'transfer':
                    case 'transfer_to_vesting':
                    case 'transfer_to_savings':
                    case 'transfer_from_savings':
                        addUsers(operation[1].from, operation[1].to);
                        break;
                    case 'fill_vesting_withdraw':
                    case 'set_withdraw_vesting_route':
                        addUsers(operation[1].from_account, operation[1].to_account);
                        break;
                    case 'fill_order':
                        addUsers(operation[1].current_owner, operation[1].open_owner);
                        break;
                    case 'request_account_recovery':
                        addUsers(operation[1].recovery_account, operation[1].account_to_recover);
                        break;
                    case 'change_recovery_account':
                        addUsers(operation[1].account_to_recover, operation[1].new_recovery_account);
                        break;
                    case 'account_create':
                    case 'account_create_with_delegation':
                        addUsers(operation[1].creator, operation[1].new_account_name);
                        break;
                    case 'account_witness_vote':
                        addUsers(operation[1].account, operation[1].witness);
                        break;
                    case 'account_witness_proxy':
                        addUsers(operation[1].account, operation[1].proxy);
                        break;
                    case 'account_update':
                    case 'claim_reward_balance':
                    case 'decline_voting_rights':
                    case 'return_vesting_delegation':
                    case 'withdraw_vesting':
                        addUsers(operation[1].account);
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
                        addUsers(operation[1].owner);
                        break;
                    case 'author_reward':
                    case 'comment_options':
                    case 'comment_payout_update':
                    case 'comment_reward':
                    case 'delete_comment':
                        addUsers(operation[1].author);
                        break;
                    case 'curation_reward':
                        addUsers(operation[1].curator, operation[1].comment_author);
                        break;
                    case 'feed_publish':
                        addUsers(operation[1].publisher);
                        break;
                    case 'recover_account':
                        addUsers(operation[1].account_to_recover);
                        break;
                    case 'cancel_transfer_from_savings':
                        addUsers(operation[1].from);
                        break;
                    case 'comment_benefactor_reward':
                        addUsers(operation[1].benefactor, operation[1].author);
                        break;
                    case 'producer_reward':
                        addUsers(operation[1].producer);
                        break;
                    case 'prove_authority':
                        addUsers(operation[1].challenged);
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
 * @param {string} body The body of the post
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {boolean} mustBeNew Post must be new (true) or can have been updated (false)
 */
function processPost(body, author, permlink, mustBeNew) {
    steem.api.getContent(author, permlink, (err, res) => {
        if(err) {
            console.error(`Request error (getContent): ${ err.message } with ${ request_nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            request_nodes.push(request_nodes.shift());
            steem.api.setOptions({ url: request_nodes[0] });
            console.log(`Retrying with ${ request_nodes[0] }`);
            processPost(body, author, permlink, mustBeNew);
        } else {
            if(mustBeNew && res.last_update === res.created) {
                if(users[author].delay > 0) {
                    setTimeout(() => { 
                        processPost(body, author, permlink, false);
                    }, users[author].delay * 60 * 1000);
                } else mustBeNew = false;
            }
            if(!mustBeNew) {
                try {
                    const metadata = JSON.parse(res.json_metadata);
                    // Removing the punctuation at the end of some mentions, lower casing mentions, removing duplicates and already encountered existing users
                    let mentions = _.uniq(metadata.users.map(user => user.replace(/[?¿!¡.,;:-]+$/, '').toLowerCase())).filter(user => user.length > 2 && !users[user]);
                    // Removing all variations of the author username
                    const authorRegex = new RegExp(author.replace(/([a-z]+|\d+)/g, '($1)?').replace(/[.-]/g, '[.-]?'));
                    mentions = mentions.filter(mention => {
                        return mention.match(authorRegex).every(match => match === undefined || match === '');
                    });
                    // Removing ignored mentions
                    if(users[author].ignored.length > 0) mentions = mentions.filter(mention => !users[author].ignored.includes(mention));
                    if(mentions.length > 0) processMentions(mentions, body, author, permlink, res.title, res.parent_author === '' ? 'post' : 'comment');
                } catch(err) {}
            }
        }
    });
}

/**
 * Filters out all the correct mentions from an array of possibly wrong mentions and pushes a comment to the comments array if necessary
 * @param {string[]} mentions All the possibly wrong mentions
 * @param {string} body The body of the post (used for social network checking)
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @param {string} title The title of the post
 * @param {string} type The type of the post (post or comment)
 */
function processMentions(mentions, body, author, permlink, title, type) {
    steem.api.lookupAccountNames(mentions, (err, res) => {
        if(err) {
            console.error(`Request error (lookupAccountNames): ${ err.message } with ${ request_nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            request_nodes.push(request_nodes.shift());
            steem.api.setOptions({ url: request_nodes[0] });
            console.log(`Retrying with ${ request_nodes[0] }`);
            processMentions(mentions, body, author, permlink, title, type);
        } else {
            let wrongMentions = [];
            // Adding each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
            for(let i = 0; i < mentions.length; i++) {
                if(res[i] === null) {
                    // Adding the username to the wrongMentions array only if it doesn't contain a social network reference in the ~600 characters surrounding it
                    const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\\w/=-])@' + _.escapeRegExp(mentions[i]) + '(?:[^\\w/-][\\s\\S]{0,299}|$)', 'gi');
                    const match = body.match(regex);
                    if(match && !/(insta|tele)gram|tw(it?ter|eet)|golos|discord|medium|brunch|텔레그램/i.test(match)) wrongMentions.push('@' + mentions[i]);
                } else addUsers(mentions[i]);
            }
            // Sending a message if any wrong mention has been found in the post/comment
            if(wrongMentions.length > 0) {
                let message = `Hi @${ author }, I'm @checky ! While checking the mentions made in this ${ type } I found out that `;
                if(wrongMentions.length > 1) {
                    wrongMentions = wrongMentions.map(mention => mention + ',');
                    wrongMentions[wrongMentions.length-1] = wrongMentions[wrongMentions.length-1].replace(',', '');
                    wrongMentions[wrongMentions.length-2] = wrongMentions[wrongMentions.length-2].replace(',', ' and');
                    message += `${ wrongMentions.join(' ') } don't exist on Steem. Maybe you made some typos ?`;
                } else message += `${ wrongMentions[0] } doesn't exist on Steem. Maybe you made a typo ?`;
                comments.push([message, author, permlink, 'Possible wrong mentions found in ' + title]);
            }
        }
    });
}

/**
 * Processes a command written by a user
 * @param {RegExpExecArray} command The command written by the user as well as its parameters
 * @param {string} author The user who wrote the command
 * @param {string} permlink The permlink of the comment in which the command has been written
 */
function processCommand(command, author, permlink) {
    switch(command[1]) {
        case 'ignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                users[author].ignored = _.union(users[author].ignored, mentions);
                comments.push([`The following mentions will now be ignored when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky stop ignoring them, reply to any of my posts with \`!unignore username1 username2 ...\`.`, author, permlink, `Added some ignored mentions for @${ author }`]);
            } else comments.push(['You didn\'t specify any username to ignore. Please try again by using the format `!ignore username1 username2`.', author, permlink, 'No username specified']);
            break;
        case 'unignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', '').toLowerCase());
                mentions.forEach(mention => _.pull(users[author].ignored, mention));
                comments.push([`The following mentions will now be checked by @checky when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky start ignoring them again, reply to any of my posts with \`!ignore username1 username2 ...\`.`, author, permlink, `Removed some ignored mentions for @${ author }`]);
            } else comments.push(['You didn\'t specify any username to unignore. Please try again by using the format `!unignore username1 username2`.', author, permlink, 'No username specified']);
            break;
        // Shortcuts for !mode [on-off]
        case 'on':
        case 'off':
            command = [command[0], 'mode', command[1]];
        case 'mode':
        case 'switch':
            if(command[2]) {
                // Removing white spaces arround the parameter
                const mode = _.trim(command[2]);
                switch(mode) {
                    case 'on':
                    case 'regular':
                    case 'normal':
                        users[author].mode = 'regular';
                        comments.push(['Your account has been set to regular. You will now only get your mentions checked for posts you make.', author, permlink, 'Account set to regular']);
                        break;
                    case 'advanced':
                    case 'plus':
                        users[author].mode = 'advanced';
                        comments.push(['Your account has been set to advanced. You will now get your mentions checked for posts and comments you make.', author, permlink, 'Account set to advanced']);
                        break;
                    case 'off':
                        users[author].mode = 'off';
                        comments.push(['Your account has been set to off. None of your mentions will now be checked whatsoever.', author, permlink, 'Account set to off']);
                        break;
                    default:
                        comments.push([`The ${ mode } mode doesn't exist. Your account is currently set to ${ users[account].mode }. To switch it to regular, advanced or off, please write \`!mode [regular-advanced-off]\`.`, author, permlink, 'Wrong mode specified']);
                }
            } else comments.push([`You didn't spectify any mode to switch to. Please try again by using \`!${ command[1] } regular\`, \`!${ command[1] } advanced\` or \`!${ command[1] } off\`.`, author, permlink, 'No mode specified']);
            break;
        case 'state':
            let ignored = 'No mentions are being ignored by @checky';
            if(users[author].ignored.length > 0) ignored = 'The following mentions are being ignored by @checky: ' + users[author].ignored.join(', ');
            comments.push([`Your account is currently set to ${ users[author].mode }. Your posts are being checked ${ users[author].delay } minute${ users[author].delay !== 1 ? 's' : '' } after being posted. ${ ignored }.`, author, permlink, 'Account state']);
            break;
        case 'wait':
        case 'delay':
            if(command[2]) {
                const delay = parseInt(command[2]);
                if(!Number.isNaN(delay)) {
                    users[author].delay = Math.abs(delay);
                    if(delay > 0 ) comments.push([`The delay has been set to ${ delay } minute${ delay > 1 ? 's' : '' }. @checky will now wait ${ delay } minute${ delay > 1 ? 's' : '' } before checking your mentions.`, author, permlink, `Delay set to ${ delay } minute${ delay > 1 ? 's' : '' }`]);
                    else comments.push([`The delay has been set to ${ delay } minutes. @checky will instantly check your mentions when you post.`, author, permlink, `Delay set to ${ delay } minute${ delay > 1 ? 's' : '' }`])
                } else comments.push(['You didn\'t correctly specify the delay. Please try again by using a number to represent the delay.', author, permlink, `Delay wrongly specified`]);
            } else comments.push([`You didn't specify the delay. Please try again by using \`!${ command[1] } minutes`, author, permlink, 'No delay specified']);
            break;
        case 'help':
            const message = '#### Here are all the available commands:\n* **!delay** *minutes* **-** tells the bot to wait X minutes before checking your posts.\n* **!help** **-** gives a list of commands and their explanations.\n* **!ignore** *username1* *username2* **-** tells  the bot to ignore some usernames mentioned in your posts (useful to avoid the bot mistaking other social network accounts for Steem accounts).\n* **!mode** *[regular-advanced-off]* **-** sets the mentions checking to regular (only posts), advanced (posts and comments) or off (no checking). Alternatively, you can write *normal* or *on* instead of *regular*. You can also write *plus* instead of *advanced*.\n* **!off** **-** shortcut for **!mode off**.\n* **!on** **-** shortcut for **!mode on**.\n* **!state** **-** gives the state of your account (*regular*, *advanced* or *off*).\n* **!switch** *[regular-advanced-off]* **-** same as **!mode**.\n* **!unignore** *username1* *username2* **-** tells the bot to unignore some usernames mentioned in your posts.\n* **!wait** *minutes* - same as **!delay**.\n\n###### Any idea on how to improve this bot ? Please contact @ragepeanut on any of his posts or send him a direct message on discord (RagePeanut#8078).';
            comments.push([message, author, permlink, 'Commands list']);
            break;
        default:
            comments.push(['This command doesn\'t exist.', author, permlink, 'Unknown command']);
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
        app: 'checky/0.0.2',
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

/**
 * Adds users to the users object if not encountered before
 * @param {string[]} encounteredUsers The users encountered while reading an operation
 */
function addUsers(...encounteredUsers) {
    encounteredUsers.forEach(user => {
        if(user !== '' && !users[user]) users[user] = { mode: 'regular', ignored: [], delay: 0 };
    });
}
