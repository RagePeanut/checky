const fs = require('fs');
const steem = require('steem');
const { request_nodes } = require('../config');
const { merge } = require('./helper');

const unallowedUsernameRegex = /(^|\.)[\d.-]|[.-](\.|$)|-{2}|.{17}|(^|\.).{0,2}(\.|$)/;

steem.api.setOptions({ url: request_nodes[0] });

// Creating a users object and updating it with the content of ./data/users.json if the file exists 
let users = {};
if(fs.existsSync('data')) {
    if(fs.existsSync('data/users.json')) users = require('../data/users');
} else fs.mkdirSync('data');

// Updating the ./data/users.json file with the content of the users object every 5 seconds
updateUsersFile(5);

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
        users[username].occ++;
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
            users[username] = { mode: 'regular', ignored: [], delay: 0, occ: 0, mentioned: [] };
        }
    });
}

/**
 * Corrects a wrong username
 * @param {string} username The username to be corrected
 * @param {string} author The author of the post
 * @param {string[]} otherMentions The correct mentions made in the post
 * @param {string[]} tags The tags of the post
 * @returns {Promise<string>} A correct username close to the wrong one, returns null if no username is found
 */
function correct(username, author, otherMentions, tags) {
    return new Promise(async resolve => {
        // Adding `author` to `otherMentions` to avoid repeating the same testing code twice
        if(!otherMentions.includes(author)) otherMentions.unshift(author);
        // Testing for username variations
        const usernameNoPunct = username.replace(/[\d.-]/g, '');
        let suggestion = otherMentions.find(mention => {
            const mentionNoPunct = mention.replace(/[\d.-]/g, '');
            return usernameNoPunct === mentionNoPunct || 'the' + usernameNoPunct === mentionNoPunct;
        });
        if(suggestion) return resolve('@<em></em>' + suggestion);
        // Testing for usernames that are one edit away from the wrong username
        let edits = new Set();
        edits1(username, edits, false);
        let suggestions = await getExisting(edits);
        if(suggestions.length === 0) {
            // Testing for usernames that are two edits away from the wrong username
            edits = edits2(edits);
            suggestions = await getExisting(edits);
        }
        if(suggestions.length > 0) {
            if(suggestions.length === 1) return resolve('@<em></em>' + suggestions[0]);
            // Trying to find the better suggestion based on the mentions made by the author in the post and, if needed, in his previous posts
            suggestion = suggestions.find(mention => otherMentions.includes(mention) || users[author].mentioned.includes(mention));
            if(suggestion) return resolve('@<em></em>' + suggestion);
            // Suggesting the most mentioned username overall
            return resolve('@<em></em>' + suggestions.sort((a, b) => users[b].occ - users[a].occ)[0]);
        } else if(await exists('the' + username)) return resolve('@<em></em>the' + username);
        // Testing for tags written as mentions
        else if(tags.includes(username)) return resolve('#' + username)
        // No suggestion
        else return resolve(null);
    });
}

/**
 * Generates all the edits that are one edit away from `username`
 * @param {string} username The wrong username
 * @param {Set<string>} edits The current edits
 * @param {boolean} mustBeValid Whether or not the edits generated must be valid usernames
 */
function edits1(username, edits, mustBeValid) {
    const characters = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','0','1','2','3','4','5','6','7','8','9','.','-'];
    deletes(username, edits, mustBeValid);
    transposes(username.split(''), edits, mustBeValid);
    replaces(username, edits, characters, mustBeValid);
    inserts(username, edits, characters, mustBeValid);
}

/**
 * Generates all the edits that are two edits away from `username`
 * @param {Set<string>} edits The edits one edit away from `username`
 * @returns {Set<string>} The edits two edits away from `username`
 */
function edits2(edits) {
    const ed2 = new Set();
    edits.forEach(edit => edits1(edit, ed2, true));
    return ed2;
}

/**
 * Generates all the variations of `username` with one character deleted
 * @param {string} username The username
 * @param {Set<string>} edits The current edits
 * @param {boolean} mustBeValid Whether or not the edits generated must be valid usernames
 */
function deletes(username, edits, mustBeValid) {
    for(let i = 0; i < username.length; i++) {
        const del = username.substr(0, i) + username.substr(i + 1, username.length);
        if(!mustBeValid || !unallowedUsernameRegex.test(del)) edits.add(del);
    }
}

/**
 * Generates all the variations of `username` with one character inserted
 * @param {string} username The username
 * @param {Set<string>} edits The current edits
 * @param {string[]} characters The characters allowed
 * @param {boolean} mustBeValid Whether or not the edits generated must be valid usernames
 */
function inserts(username, edits, characters, mustBeValid) {
    for(let i = 0; i <= username.length; i++) {
        const firstPart = username.substr(0, i);
        const lastPart = username.substr(i, username.length);
        for(let j = 0; j < characters.length; j++) {
            const insert = firstPart + characters[j] + lastPart;
            if(!mustBeValid || !unallowedUsernameRegex.test(insert)) edits.add(insert);
        }
    }
}

/**
 * Generates all the variations of `username` with one character replaced
 * @param {string} username The username
 * @param {Set<string>} edits The current edits
 * @param {string[]} characters The characters allowed
 * @param {boolean} mustBeValid Whether or not the edits generated must be valid usernames
 */
function replaces(username, edits, characters, mustBeValid) {
    for(let i = 0; i < username.length; i++) {
        const firstPart = username.substr(0, i);
        const lastPart = username.substr(i + 1, username.length);
        for(let j = 0; j < characters.length; j++) {
            if(username[i] !== characters[j]) {
                const replace = firstPart + characters[j] + lastPart;
                if(!mustBeValid || !unallowedUsernameRegex.test(replace)) edits.add(replace);
            }
        }
    }
}

/**
 * Generates all the variations of `username` with two adjacent characters swapped
 * @param {string[]} splits The characters contained in `username`
 * @param {Set<string>} edits The current edits
 * @param {boolean} mustBeValid Whether or not the edits generated must be valid usernames
 */
function transposes(splits, edits, mustBeValid) {
    for(let i = 0; i < splits.length; i++) {
        if(splits[i] !== splits[i+1]) {
            const temp = splits.slice();
            temp[i] = splits[i+1];
            temp[i+1] = splits[i];
            const transpose = temp.join('');
            if(!mustBeValid || !unallowedUsernameRegex.test(transpose)) edits.add(transpose);
        }
    }
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
 * @param {Set<string>} usernames The usernames
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
        if(toCheck.length === 0) return resolve([...usernames]);
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

/**
 * Updates the ./data/users.json file with the content of the users object (recursively called every `interval` seconds)
 * @param {number} interval The interval between the end of a file updated and the beginning of the next file update
 */
function updateUsersFile(interval) {
    fs.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err) console.error(err.message);
        setTimeout(updateUsersFile, interval * 1000, interval);
    })
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
