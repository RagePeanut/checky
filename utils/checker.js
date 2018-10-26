const fs = require('fs');
const steno = require('steno');
const { log_errors } = require('../config');
const { merge } = require('./helper');
let steemer = require('./steemer');

const unallowedUsernameRegex = /(^|\.)[\d.-]|[.-](\.|$)|-{2}|.{17}|(^|\.).{0,2}(\.|$)/;

// Creating a users object
let users = {};

/**
 * Initializes the username checker
 * @param {steemer} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    // Updating `users` with the content of ./data/users.json if the file exists 
    if(fs.existsSync('data')) {
        if(fs.existsSync('data/users.json')) users = require('../data/users');
    } else fs.mkdirSync('data');
    // Updating the ./data/users.json file with the content of the users object every 5 seconds
    updateUsersFile(5);
    steemer = _steemer;
}

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
async function correct(username, author, otherMentions, tags) {
    // Adding `author` to `otherMentions` to avoid repeating the same testing code twice
    if(!otherMentions.includes(author)) otherMentions.unshift(author);
    // Testing for username variations
    const usernameNoPunct = username.replace(/[\d.-]/g, '');
    let suggestion = otherMentions.find(mention => {
        const mentionNoPunct = mention.replace(/[\d.-]/g, '');
        return usernameNoPunct === mentionNoPunct || 'the' + usernameNoPunct === mentionNoPunct;
    });
    if(suggestion) return '@<em></em>' + highlightDifferences(username, suggestion);
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
        if(suggestions.length === 1) return '@<em></em>' + highlightDifferences(username, suggestions[0]);
        // Trying to find a suggestion based on the mentions made by the author in the post and, if needed, in his previous posts
        suggestion = suggestions.find(mention => otherMentions.includes(mention) || users[author].mentioned.includes(mention));
        if(suggestion) return '@<em></em>' + highlightDifferences(username, suggestion);
        // Trying to find a suggestion based on the followers and followees of the author of the post
        const followCircle = await steemer.getFollowCircle(author);
        suggestion = suggestions.find(mention => followCircle.has(mention));
        if(suggestion) return '@<em></em>' + highlightDifferences(username, suggestion);
        // Suggesting the most mentioned username overall
        return '@<em></em>' + highlightDifferences(username, suggestions.sort((a, b) => users[b].occ - users[a].occ)[0]);
    } else if(await exists('the' + username)) return '@<em></em><strong>the</strong>' + username;
    // Testing for tags written as mentions
    else if(tags.includes(username) || await isTag(author, username, tags)) return '#' + username;
    // No suggestion
    else return null;
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
 * Highlights the differences between a wrong username and its suggested correction
 * @param {string} username A wrong username
 * @param {string} correction The wrong username's suggested correction
 * @returns {string} The correction with its differences highlighted (between strong tags)
 */
function highlightDifferences(username, correction) {
    // Two deletes (deletes can't be highlighted)
    if(username.length === correction.length + 2) return correction;
    let highlighted = correction.split('');
    for(let i = 0; i < correction.length; i++) {
        if(correction[i] !== username[i]) {
            if(correction.length > username.length) {
                username = username.substring(0, i + 1) + username.substring(i, username.length);
            }
            if(correction.length >= username.length) {
                highlighted[i] = '<strong>' + correction[i] + '</strong>';
            }
        }
    }
    return highlighted.join('')
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
 * Checks if a received word is a popular tag or has been used by the author as a tag
 * @param {string} author The author of the post
 * @param {string} word The word to check
 * @param {string[]} tags The tags of the post
 * @returns {Promise<boolean>} Whether or not the word actually is a tag 
 */
async function isTag(author, word, tags) {
    if(tags.includes(word)) return true;
    tags = await steemer.getTrendingTags();
    if(tags.some(tag => tag === word)) return true;
    tags = await steemer.getTagsByAuthor(author);
    if(tags.some(tag => tag === word)) return true;
    return false;
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
async function getExisting(usernames) {
    const existing = [];
    const toCheck = [];
    usernames.forEach(username => {
        if(users.hasOwnProperty(username)) existing.push(username);
        else toCheck.push(username);
    });
    if(toCheck.length === 0) return [...usernames];
    for(let i = 0; i < toCheck.length; i += 10000) {
        const discovered = await steemer.lookupAccountNames(toCheck.slice(i, i + 10000));
        for(let j = 0; j < discovered.length; j++) {
            existing.push(discovered[j]);
        }
        addUsers(null, discovered);
    }
    return existing;
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
    steno.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err && log_errors) console.error(err.message);
        setTimeout(updateUsersFile, interval * 1000, interval);
    });
}

module.exports = {
    addIgnored,
    addMentioned,
    addUsers,
    correct,
    exists,
    getExisting,
    getUser,
    init,
    removeIgnored,
    setDelay,
    setMode
}
