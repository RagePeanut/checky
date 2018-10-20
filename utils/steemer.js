const steem = require('steem');
const { fail_safe_node, log_errors } = require('../config');

const postingKey = process.env.CHECKY_POSTING_KEY;

let nodes = [fail_safe_node];

/**
 * Broadcasts a comment
 * @param {string} parentAuthor The author of the post to reply to
 * @param {string} parentPermlink The permlink of the post to reply to
 * @param {string} permlink The permlink of the comment
 * @param {string} title The title of the comment
 * @param {string} body The body of the comment
 * @param {string} jsonMetadata The stringified metadata attached to the comment
 * @returns {Promise<void>} An empty promise returned when the comment has been broadcasted
 */
async function broadcastComment(parentAuthor, parentPermlink, permlink, title, body, jsonMetadata) {
    try {
        await steem.broadcast.commentAsync(postingKey, parentAuthor, parentPermlink, 'checky', permlink, title, body, jsonMetadata);
        return;
    } catch(err) {
        if(log_errors) console.error(`Broadcast error: ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await broadcastComment(parentAuthor, parentPermlink, permlink, title, body, jsonMetadata);
    }
}

/**
 * Gets the content of a post
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @return {Promise<any>} The content of the post
 */
async function getContent(author, permlink) {
    try {
        const content = await steem.api.getContentAsync(author, permlink);
        return content;
    } catch(err) {
        if(log_errors) console.error(`Request error (getContent): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getContent(author, permlink);
    }
}

/**
 * Gets the tags used by `author`
 * @param {string} author The author that used those tags
 * @returns {Promise<string[]>} The tags used by `author`
 */
async function getTagsByAuthor(author) {
    try {
        const tags = await steem.api.getTagsUsedByAuthorAsync(author);
        return tags.map(tag => tag.name);
    } catch(err) {
        if(log_errors) console.error(`Request error (getTagsUsedByAuthor): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getTagsByAuthor(author);
    }
}

/**
 * Gets the 1000 first trending tags
 * @returns {Promise<string[]>} The 1000 first trending tags
 */
async function getTrendingTags() {
    try {
        const tags = await steem.api.getTrendingTagsAsync('', 1000);
        return tags.map(tag => tag.name);
    } catch(err) {
        if(log_errors) console.error(`Request error (getTrendingTags): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getTrendingTags();
    }
}

/**
 * Checks if the `usernames` exist on the blockchain
 * @param {string[]} usernames The usernames to check
 * @returns {Promise<string[]>} The usernames that exist on the blockchain 
 */
async function lookupAccountNames(usernames) {
    try {
        const result = await steem.api.lookupAccountNamesAsync(usernames);
        return result.filter(user => user).map(user => user.name);
    } catch(err) {
        if(log_errors) console.error(`Request error (lookupAccountNames): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await lookupAccountNames(usernames);
    }
}

 /**
  * Updates the nodes used by the bot
  * @param {function():string[]} callback The callback that is called when new nodes are received
  */
function updateNodes(callback) {
    steem.api.getAccounts(['fullnodeupdate'], (err, res) => {
        if(err) console.log(err);// return updateNodes(callback);
        const newNodes = JSON.parse(res[0].json_metadata).nodes.filter(node => !/^wss/.test(node));
        const gotNewNodes = newNodes.length > 0;
        if(gotNewNodes) {
            nodes = newNodes;
            callback(newNodes);
        }
        steem.api.setOptions({ url: nodes[0] });
        setInterval(updateNodes, 3 * 60 * 60 * 1000, callback);
    });
}

module.exports = {
    broadcastComment,
    getContent,
    getTagsByAuthor,
    getTrendingTags,
    lookupAccountNames,
    updateNodes
}