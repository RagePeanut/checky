const fs = require('fs');
const steem = require('steem');
const { request_nodes } = require('../config');
const { merge, uniq } = require('./helper');

const unallowedUsernameRegex = /(^|\.)[\d.-]|[.-](\.|$)|-{2}|.{17}|(^|\.).{0,2}(\.|$)/;

steem.api.setOptions({ url: request_nodes[0] });

// Creating a users object and updating it with the content of ./data/users.json if the file exists 
let users = {};
if(fs.existsSync('data')) {
    if(fs.existsSync('data/users.json')) users = require('../data/users');
} else fs.mkdirSync('data');

// Updating the ./data/users.json file with the content of the users object every 5 seconds
setInterval(() => {
    fs.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err) console.error(err.message);
    });
}, 5 * 1000);

/**
 * Adds usernames to an author's ignored mentions
 * @param {string} author The author
 * @param {string[]} usernames The usernames to be ignored when mentioned
 */
function addIgnored(author, usernames) {
    users[author].ignored = merge(users[author].ignored, usernames);
}

/**
 * Adds usernames to the list of mentions made by an author over time
 * @param {string} author The author
 * @param {string[]} usernames The usernames mentioned by the author
 */
function addMentioned(author, usernames) {
    usernames.forEach(username => {
        if(!users[author].mentioned.includes(username)) users[author].mentioned.push(username);
        users[username].occurrences++;
    });
}

/**
 * Adds users to the users object if not encountered before
 * @param {string} origin The account the operation originates from
 * @param {string[]|string[][]} usernames The usernames encountered while reading the operation
 */
function addUsers(origin, ...usernames) {
    if(origin) addUsers(null, origin);
    if(usernames.length > 0 && typeof usernames[0] === 'object') usernames = usernames[0];
    usernames.forEach(username => {
        if(username !== '' && !users.hasOwnProperty(username)) {
            users[username] = { mode: 'regular', ignored: [], delay: 0, occurrences: 0, mentioned: [] };
        }
    });
}

/**
 * Corrects a wrong username
 * @param {string} username The username to be corrected
 * @param {string} author The author of the post
 * @param {string[]} otherMentions The correct mentions made in the post
 * @returns {Promise<string>} A correct username close to the wrong one, returns null if no username is found
 */
function correct(username, author, otherMentions) {
    return new Promise(async resolve => {
        // Adding `author` to `otherMentions` to avoid repeating the same testing code twice
        if(!otherMentions.includes(author)) otherMentions.unshift(author);
        // Testing for username variations
        const usernameNoPunct = username.replace(/[\d.-]/g, '');
        let suggestion = otherMentions.find(mention => {
            const mentionNoPunct = mention.replace(/[\d.-]/g, '');
            return usernameNoPunct === mentionNoPunct || 'the' + usernameNoPunct === mentionNoPunct;
        });
        if(suggestion) return resolve(suggestion);
        if(await exists('the' + username)) return resolve('the' + username);
        // Testing for usernames that are one edit away from the wrong username
        const ed1 = edits1(username, false);
        let suggestions = await getExisting(ed1);
        if(suggestions.length === 0) {
            // Testing for usernames that are two edits away from the wrong username
            const ed2 = edits2(ed1);
            suggestions = await getExisting(ed2);
        }
        if(suggestions.length > 0) {
            if(suggestions.length === 1) return resolve(suggestions[0]);
            // Trying to find the better suggestion based on the mentions made by the author in the post and, if needed, in his previous posts
            suggestion = suggestions.find(mention => otherMentions.includes(mention) || users[author].mentioned.includes(mention));
            if(suggestion) return resolve(suggestion);
            // Suggesting the most mentioned username overall
            return resolve(suggestions.sort((a, b) => users[b].occurrences - users[a].occurrences)[0]);
        // No suggestion
        } else return resolve(null);
    });
}

/**
 * Generates all the edits that are one edit away from `username`
 * @param {string} username The wrong username
 * @param {boolean} calledByEdits2 Whether or not edits1() has been called by edits2()
 * @returns {string[]} The edits one edit away from `username`
 */
function edits1(username, calledByEdits2) {
    const characters = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','0','1','2','3','4','5','6','7','8','9','.','-'];
    const deletes = getDeletes(username, !calledByEdits2);
    const transposes = getTransposes(username.split(''), !calledByEdits2);
    const replaces = getReplaces(username, characters, !calledByEdits2);
    const inserts = getInserts(username, characters, !calledByEdits2);
    return merge(deletes, transposes, replaces, inserts);
}

/**
 * Generates all the edits that are two edits away from `username`
 * @param {string[]} edits The edits one edit away from `username`
 * @returns {string[]} The edits two edits away from `username`
 */
function edits2(edits) {
    let edits2 = [];
    for(let i = 0; i < edits.length; i++) {
        const ed = edits1(edits[i], true);
        edits2 = edits2.concat(ed);
    }
    return uniq(edits2);
}

/**
 * Generates all the variations of `username` with one character deleted
 * @param {string} username The username
 * @param {boolean} fromEdits1 Whether or not the function has been called from edits1()
 * @returns {string[]} The variations of `username` with one character deleted
 */
function getDeletes(username, fromEdits1) {
    const deletes = [];
    for(let i = 0; i < username.length; i++) {
        const del = username.substr(0, i) + username.substr(i + 1, username.length);
        if(fromEdits1 || !unallowedUsernameRegex.test(del)) deletes.push(del);
    }
    return deletes;
}

/**
 * Generates all the variations of `username` with one character inserted
 * @param {string} username The username
 * @param {string[]} characters The characters allowed
 * @param {boolean} fromEdits1 Whether or not the function has been called from edits1()
 * @returns {string[]} The variations of `username` with one character inserted
 */
function getInserts(username, characters, fromEdits1) {
    const inserts = [];
    for(let i = 0; i <= username.length; i++) {
        const firstPart = username.substr(0, i);
        const lastPart = username.substr(i, username.length);
        for(let j = 0; j < characters.length; j++) {
            const insert = firstPart + characters[j] + lastPart;
            if(fromEdits1 || !unallowedUsernameRegex.test(insert)) inserts.push(insert);
        }
    }
    return inserts;
}

/**
 * Generates all the variations of `username` with one character replaced
 * @param {string} username The username
 * @param {string[]} characters The characters allowed
 * @param {boolean} fromEdits1 Whether or not the function has been called from edits1()
 * @returns {string[]} The variations of `username` with one character replaced
 */
function getReplaces(username, characters, fromEdits1) {
    const replaces = [];
    for(let i = 0; i < username.length; i++) {
        const firstPart = username.substr(0, i);
        const lastPart = username.substr(i + 1, username.length);
        for(let j = 0; j < characters.length; j++) {
            if(username[i] !== characters[j]) {
                const replace = firstPart + characters[j] + lastPart;
                if(fromEdits1 || !unallowedUsernameRegex.test(replace)) replaces.push(replace);
            }
        }
    }
    return replaces;
}

/**
 * Generates all the variations of `username` with two adjacent characters swapped
 * @param {string[]} splits The characters contained in `username`
 * @param {boolean} fromEdits1 Whether or not the function has been called from edits1()
 * @returns {string[]} The variations of `username` with two adjacent characters swapped
 */
function getTransposes(splits, fromEdits1) {
    const transposes = [];
    for(let i = 0; i < splits.length; i++) {
        if(splits[i] !== splits[i+1]) {
            const temp = splits.slice();
            temp[i] = splits[i+1];
            temp[i+1] = splits[i];
            const transpose = temp.join('');
            if(fromEdits1 || !unallowedUsernameRegex.test(transpose)) transposes.push(transpose);
        }
    }
    return transposes;
}

/**
 * Gives the user object associated with a username
 * @param {string} username The user's username
 * @returns {object} The user, returns undefined if the user doesn't exist in `users`
 */
function getUser(username) {
    return users[username];
}

/**
 * Returns whether or not a username is known
 * @param {string} username The username
 * @returns {Promise<boolean>} Whether or not the username exists on the Steem blockchain
 */
async function exists(username) {
    return (await getExisting([username])).length === 1;
}

/**
 * Returns the received usernames that are known
 * @param {string[]} usernames The usernames
 * @returns {Promise<string[]>} The usernames that exist on the Steem blockchain
 */
function getExisting(usernames) {
    let existing = [];
    const toCheck = [];
    return new Promise(resolve => {
        usernames.forEach(username => {
            if(users.hasOwnProperty(username)) existing.push(username);
            else toCheck.push(username);
        });
        if(toCheck.length === 0) return resolve(usernames);
        const promises = [];
        for(let i = 0; i < toCheck.length; i += 10000) {
            promises.push(getDiscovered(toCheck.slice(i, i + 10000)))
        }
        Promise.all(promises)
               .then(discovered => {
                   for(let i = 0; i < discovered.length; i++) {
                       for(let j = 0; j < discovered[i].length; j++) {
                           existing.push(discovered[i][j]);
                       }
                   }
                   return resolve(existing);
               });
    });
}

/**
 * Returns the received usernames that exist on the Steem blockchain
 * @param {string[]} usernames An array of usernames that may exist on the blockchain
 * @returns {Promise<string[]>} The usernames from the received list that exist on the blockchain
 */
function getDiscovered(usernames) {
    return new Promise(resolve => {
        steem.api.lookupAccountNames(usernames, async (err, res) => {
            if(err) return resolve(await getDiscovered(usernames));
            const discovered = res.filter(user => user).map(user => user.name);
            addUsers(null, discovered);
            return resolve(discovered);
        });
    });
}

/**
 * Removes usernames from an author's ignored mentions
 * @param {string} author The author
 * @param {string[]} mentions The usernames to be removed from the ignored mentions
 */
function removeIgnored(author, mentions) {
    users[author].ignored = users[author].ignored.filter(mention => !mentions.includes(mention));
}

/**
 * Sets the delay before checking mentions for a given user
 * @param {string} username The user's username
 * @param {number} delay The delay to set
 * @returns {boolean} Whether or not the delay was successfully set
 */
function setDelay(username, delay) {
    if(!Number.isNaN(delay)) {
        users[username].delay = Math.abs(delay);
        return true;
    }
    return false;
}

/**
 * Sets the mode for a given user
 * @param {string} username The user's username
 * @param {string} mode The mode to set 
 */
function setMode(username, mode) {
    users[username].mode = mode;
}

module.exports = {
    addIgnored,
    addMentioned,
    addUsers,
    correct,
    exists,
    getExisting,
    getUser,
    removeIgnored,
    setDelay,
    setMode
}
