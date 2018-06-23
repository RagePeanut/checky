const _ = require('lodash');
const fs = require('fs');
const steemStream = require('steem');
const steemRequest = require('steem');
const { posting_key, request_nodes, stream_nodes } = require('./config');

steemRequest.api.setOptions({ url: request_nodes[0] });

let blacklist = [];
let ignoredMentions = {};
let users = {};
if(fs.existsSync('data/')) {
    if(fs.existsSync('data/blacklist.json')) blacklist = JSON.parse(fs.readFileSync('data/blacklist.json', 'utf8'));
    if(fs.existsSync('data/ignored_mentions.json')) ignoredMentions = JSON.parse(fs.readFileSync('data/ignored_mentions.json', 'utf8'));
    if(fs.existsSync('data/users.json')) users = JSON.parse(fs.readFileSync('data/users.json', 'utf8'));
} else fs.mkdirSync('data');

setInterval(() => {
    fs.writeFile('data/blacklist.json', JSON.stringify(blacklist), err => {
        if(err) console.log(err);
    });
    fs.writeFile('data/ignored_mentions.json', JSON.stringify(ignoredMentions), err => {
        if(err) console.log(err);
    });
    fs.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err) console.log(err);
    });
}, 60 * 1000);

stream();

function stream() {
    new Promise((resolve, reject) => {
        steemStream.api.setOptions({ url: stream_nodes[0] })
        steemStream.api.streamOperations((error, operation) => {
            if(error) return reject(error);
            if(operation && operation[0] === 'comment') {
                if(operation[1].parent_author === 'checky') {
                    const command = /[!/]([A-Za-z]+)(?:\s+(.+))?/.exec(operation[1].body);
                    if(command[1]) processCommand(command, operation[1].author, operation[1].permlink);
                } else if(operation[1].parent_author === '' || users[operation[1].author] && users[operation[1].author].mode === 'advanced') {
                    if(!blacklist.includes(operation[1].author)) {
                        try {
                            const metadata = JSON.parse(operation[1].json_metadata);
                            // Removing the punctuation at the end of some mentions, lower casing mentions, removing duplicates and already encountered existing users
                            let mentions = _.uniq(metadata.users.map(user => user.replace(/[?¿!¡.,;:-]+$/, '').toLowerCase())).filter(user => !users[user]);
                            // Removing ignored mentions
                            if(ignoredMentions[operation[1].author]) mentions = mentions.filter(mention => !ignoredMentions[operation[1].author].includes(mention));
                            if(!users[operation[1].author]) users[operation[1].author] = { mode: 'regular' };
                            if(mentions.length > 0) processCreatedPost(mentions, operation[1].body, operation[1].author, operation[1].permlink);
                        } catch(err) {}
                    }
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

function processCreatedPost(mentions, body, author, permlink) {
    new Promise((resolve, reject) => {
        steemRequest.api.getContent(author, permlink, (err, res) => {
            if(err) return reject(err);
            if(res.last_update === res.created) processMentions(mentions, body, author, permlink, res.title);
        });
    }).catch(error => {
        console.error(`Request error (getContent): ${ error.message } with ${ request_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        request_nodes.push(request_nodes.shift());
        steemRequest.api.setOptions({ url: request_nodes[0] });
        console.log(`Retrying with ${ request_nodes[0] }`)
        processCreatedPost(mentions, body, author, permlink);
    });
}

function processMentions(mentions, body, author, permlink, title) {
    new Promise((resolve, reject) => {
        steemRequest.api.lookupAccountNames(mentions, (err, res) => {
            if(err) return reject(err);
            let wrongMentions = [];
            // Add each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
            for(let i = 0; i < mentions.length; i++) {
                if(res[i] === null) {
                    const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\\w/-])@' + _.escapeRegExp(mentions[i]) + '(?:[^\\w/-][\\s\\S]{0,299}|$)', 'gi');
                    const match = body.match(regex);
                    if(match && !/(insta|tele)gram|tw(itter|eet)|medium|brunch|텔레그램/i.test(match)) wrongMentions.push('@' + mentions[i]);
                } else users[mentions[i]] = { mode: 'regular' };
            }
            if(wrongMentions.length > 0) {
                let message = `Hi @${ author },`;
                if(wrongMentions.length > 1) {
                    wrongMentions = wrongMentions.map(mention => mention + ',');
                    wrongMentions[wrongMentions.length-1] = wrongMentions[wrongMentions.length-1].replace(',', '');
                    wrongMentions[wrongMentions.length-2] = wrongMentions[wrongMentions.length-2].replace(',', ' and');
                    message = message + ` while checking the users mentioned in this post I noticed that ${ wrongMentions.join(' ') } don't exist on Steem. Maybe you made some typos ?`
                } else {
                    message = message + ` the account ${ wrongMentions[0] } mentioned in this post doesn't seem to exist on Steem. Maybe you made a typo ?`;
                }
                sendMessage(message, author, permlink, 'Possible wrong mentions found on ' + title);
            }
            console.log(wrongMentions, author);
        });
    }).catch(error => {
        console.error(`Request error (lookupAccountNames): ${ error.message } with ${ request_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        request_nodes.push(request_nodes.shift());
        steemRequest.api.setOptions({ url: request_nodes[0] });
        console.log(`Retrying with ${ request_nodes[0] }`)
        processMentions(mentions, body, author, permlink);
    });
}

function processCommand(command, author, permlink) {
    switch(command[1]) {
        case 'start':
        case 'join':
            if(blacklist.includes(author)) {
                _.pull(blacklist, author);
                sendMessage('Your mentions will from now on be inspected by @checky. If for any reason you want to stop this, reply to any of my posts with "!stop" or "!leave".', author, permlink, `Removed @${ author } from the blacklist`);
            } else sendMessage('Your mentions were already being inspected by @checky.', author, permlink, 'The blacklist hasn\'t been changed (username not in blacklist)')
            break;
        case 'stop':
        case 'leave':
            blacklist = _.union(blacklist, [author]);
            sendMessage('You\'ve been added to @checky\'s blacklist. Your mentions will from now on stop being inspected by @checky. If for any reason you want @checky to start checking your mentions again, reply to any of my posts with "!start" or "!join".', author, permlink, `Added @${ author } to the blacklist`);
            break;
        case 'ignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', ''));
                ignoredMentions[author] = _.union(ignoredMentions[author], mentions);
                sendMessage(`The following mentions will now be ignored when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky stop ignoring them, reply to any of my posts with "!unignore username1 username2 ...".`, author, permlink, `Added some ignored mentions for @${ author }`);
            } else sendMessage('You didn\'t specify any username to ignore. Please try again by using the format "!ignore username1 username2 ...".', author, permlink, 'No username specified');
            break;
        case 'unignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', ''));
                mentions.forEach(mention => {
                    if(ignoredMentions[author]) _.pull(ignoredMentions[author], mention);
                });
                sendMessage(`The following mentions will now be inspected by @checky when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky start ignoring them again, reply to any of my posts with "!ignore username1 username2 ...".`, author, permlink, `Removed some ignored mentions for @${ author }`);
            } else sendMessage('You didn\'t specify any username to unignore. Please try again by using the format "!unignore username1 username2 ...".', author, permlink, 'No username specified');
            break;
        case 'mode':
        case 'switch':
            if(command[2]) {
                const mode = _.trim(command[2]);
                switch(mode) {
                    case 'regular':
                    case 'normal':
                        users[author].mode = 'regular';
                        sendMessage('Your account mode has been set to regular. You will now only get your mentions checked for posts you make.');
                        break;
                    case 'advanced':
                        users[author].mode = 'advanced';
                        sendMessage('Your account mode has been set to advanced. You will now get your mentions checked for posts and comments.');
                        break;
                    default:
                        sendMessage(`The ${ mode } mode doesn't exist. Your account is currently set to ${ users[account].mode }, to switch it to ${ users[account].mode === 'regular' ? 'advanced' : 'regular' } please write "!mode ${ users[account].mode === 'regular' ? 'advanced' : 'regular' }".`, author, permlink, 'Wrong mode specified');
                }
            } else sendMessage('You didn\'t spectify any mode to switch to. Please try again by using "!mode regular" or "!mode advanced".', author, permlink, 'No mode specified');
        default:
            sendMessage('This command doesn\'t exist.', author, permlink, 'Unknown command');
    }
}

function sendMessage(message, author, permlink, title) {
    const metadata = {
        app: 'checky/0.0.1',
        format: 'markdown',
        tags: [ 
            'mentions',
            'bot',
            'checky'
        ],
        users: [ author ]
    }
    steemRequest.broadcast.comment(posting_key, author, permlink, 'checky', 're-' + permlink, title, message, JSON.stringify(metadata), function(err) {
        console.log(err);
    });
}