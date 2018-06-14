const _ = require('lodash');
const steemStream = require('steem');
const steemRequest = require('steem');
const { request_nodes, stream_nodes } = require('./config');

steemRequest.api.setOptions({ url: request_nodes[0] });

stream();

function stream() {
    new Promise((resolve, reject) => {
        steemStream.api.setOptions({ url: stream_nodes[0] })
        steemStream.api.streamOperations('irreversible', (error, operation) => {
            if(error) return reject(error);
            if(operation && operation[0] === 'comment' && operation[1].parent_author === '' && !/@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(operation[1].body)) {
                let metadata;
                try {
                    metadata = JSON.parse(operation[1].json_metadata);
                    // Removing empty strings
                    let mentions = metadata.users.filter(user => user !== '')
                    // Removing the dots at the end of some mentions (happens with Busy)
                                                   .map(user => user.replace(/\.+$/, ''))
                    // Removing website names
                                                   .filter(user => user.length < 5 || !/\.[a-z]{2,3}$/.test(user))
                    // Lower casing the characters
                                                   .map(user => user.toLowerCase());
                    // Removing duplicates
                    mentions = _.uniq(mentions);
                    processMentions(mentions, operation[1].body, operation[1].author, operation[1].permlink);
                } catch(err) {}
            }
        });
    }).catch(error => {
        console.error(`Stream error: ${ error.message } with ${ stream_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        stream_nodes.push(stream_nodes.shift());
        stream();
    })
}

function processMentions(mentions, body, author, permlink) {
    new Promise((resolve, reject) => {
        steemRequest.api.lookupAccountNames(mentions, (err, res) => {
            if(err) reject(err);
            const wrongMentions = [];
            // Add each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
            for(let i = 0; i < mentions.length; i++) {
                if(res[i] === null) wrongMentions.push('@' + mentions[i]);
            }
            if(wrongMentions.length > 0) {
                const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\\/])(?:' + wrongMentions.join('|') + ')(?:[^\\/][\\s\\S]{0,299}|$)', 'g');
                const matches = body.match(regex)
                if(matches) {
                    let socialNetworkRelated;
                    matches.forEach(part => {
                        socialNetworkRelated = socialNetworkRelated || /instagram|tw(itter|eet)|medium/i.test(part);
                    });
                    if(!socialNetworkRelated) {
                        sendMessage(wrongMentions);
                    }
                    console.log(wrongMentions, author, permlink);
                }
            }
        });
    }).catch(error => {
        console.error(`Request error: ${ error.message } with ${ request_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        request_nodes.push(request_nodes.shift());
        steemRequest.api.setOptions({ url: request_nodes[0] });
        console.log(`Retrying with ${ request_nodes[0] }`)
        processMentions(mentions, body, author, permlink);
    });
}

function sendMessage(wrongMentions) {
    let message;
    if(wrongMentions.length > 1) {
        wrongMentions = wrongMentions.map(mention => mention + ',');
        wrongMentions[wrongMentions.length-1] = wrongMentions[wrongMentions.length-1].replace(',', '');
        wrongMentions[wrongMentions.length-2] = wrongMentions[wrongMentions.length-2].replace(',', ' and');
        message = `Hi, while checking the users mentioned in this post I noticed that ${ wrongMentions.join(' ') } don't exist on Steem. Maybe you made some typos ?`
    } else {
        message = `Hi, the account ${ wrongMentions[0] } mentioned in this post doesn't seem to exist on Steem. Maybe you made a typo ?`;
    }
    console.log(message);
}