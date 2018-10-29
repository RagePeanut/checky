const steem = require('steem');
const { fail_safe_node, log_errors } = require('../config');

const activeKey = process.env.CHECKY_ACTIVE_KEY;

let nodes = [fail_safe_node];

/**
 * Broadcasts a comment
 * @param {string} parentAuthor The author of the post to reply to
 * @param {string} parentPermlink The permlink of the post to reply to
 * @param {string} title The title of the comment
 * @param {string} body The body of the comment
 * @param {string} jsonMetadata The stringified metadata attached to the comment
 * @returns {Promise<void>} An empty promise resolved after the comment has been broadcasted
 */
async function broadcastComment(parentAuthor, parentPermlink, title, body, jsonMetadata) {
    const permlink = 're-' + parentAuthor.replace(/\./g, '') + '-' + parentPermlink;
    try {
        await steem.broadcast.commentAsync(activeKey, parentAuthor, parentPermlink, 'checky', permlink, title, body, jsonMetadata);
        return;
    } catch(err) {
        if(log_errors) console.error(`Broadcast error (comment): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await broadcastComment(parentAuthor, parentPermlink, title, body, jsonMetadata);
    }
}

/**
 * Broadcasts an operation to delete a comment
 * @param {string} permlink The permlink of the comment
 * @returns {Promise<void>} An empty promise resolved after the comment has been deleted
 */
async function broadcastDeleteComment(permlink) {
    try {
        await steem.broadcast.deleteCommentAsync(activeKey, 'checky', permlink);
        return;
    } catch(err) {
        if(log_errors) console.error(`Broadcast error (deleteComment): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await broadcastDeleteComment(permlink);
    }
}

/**
 * Broadcasts an upvote
 * @param {string} author The author of the post to upvote
 * @param {string} permlink The permlink of the post to upvote
 * @returns {Promise<void>} An empty promise resolved after the upvote has been broadcasted
 */
async function broadcastUpvote(author, permlink) {
    try {
        await steem.broadcast.voteAsync(activeKey, 'checky', author, permlink, 10000);
        return;
    } catch(err) {
        if(log_errors) console.error(`Broadcast error (vote): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await broadcastUpvote(author, permlink);
    }
}

/** Gets the SBD and Steem balances of @checky */
async function getBalances() {
    try {
        const { balance, sbd_balance } = (await steem.api.getAccountsAsync(['checky']))[0];
        return {
            sbd: parseFloat(sbd_balance),
            steem: parseFloat(balance)
        };
    } catch(err) {
        if(log_errors) console.error(`Request error (getAccounts): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getBalances();
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
 * Gets the followers and the followees of `account`
 * @param {string} account The username of the account
 * @returns {Promise<Set<string>>} The follow circle of `account`
 */
async function getFollowCircle(account) {
    const [followers, followees] = await Promise.all([getFollowers(account, ''), getFollowees(account, '')]);
    const followCircle = new Set(followers);
    followees.forEach(followee => followCircle.add(followee));
    return followCircle;
}

/**
 * Gets the followers of `account`
 * @param {string} account The username of the account
 * @param {string} [start] The username to start at (included)
 * @returns {Promise<string[]>} The followers of `account`
 */
async function getFollowers(account, start = '') {
    try {
        const followers = await steem.api.getFollowersAsync(account, start, 'blog', 1000);
        if(followers.length < 1000) return followers.map(relation => relation.follower);
        else {
            start = followers[followers.length - 1].follower.replace(/.$/, match => String.fromCharCode(match.charCodeAt(0) + 1));
            return followers.map(relation => relation.follower).concat(await getFollowers(account, start));
        }
    } catch(err) {
        if(log_errors) console.error(`Request error (getFollowers): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getFollowers(account, start);
    }
}

/**
 * Gets the followees of `account`
 * @param {string} account The username of the account
 * @param {string} [start] The username to start at (included)
 * @returns {Promise<string[]>} The followees of `account`
 */
async function getFollowees(account, start = '') {
    try {
        const followees = await steem.api.getFollowingAsync(account, start, 'blog', 1000);
        if(followees.length < 1000) return followees.map(relation => relation.following);
        else {
            start = followees[followees.length - 1].following.replace(/.$/, match => String.fromCharCode(match.charCodeAt(0) + 1));
            return followees.map(relation => relation.following).concat(await getFollowees(account, start));
        }
    } catch(err) {
        if(log_errors) console.error(`Request error (getFollowing): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getFollowees(account, start);
    }
}

/**
 * Gets the best price to buy Steem at on the market
 * @returns {Promise<number>} The best price to buy Steem at on the market
 */
async function getLowestAsk() {
    try {
        const { lowest_ask } = await steem.api.getTickerAsync();
        return parseFloat(lowest_ask);
    } catch(err) {
        if(log_errors) console.error(`Broadcast error (getTicker): ${ err.message } with ${ nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        nodes.push(nodes.shift());
        steem.api.setOptions({ url: nodes[0] });
        if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
        return await getLowestAsk();
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
        if(err) {
            if(log_errors) console.error(`Request error (getAccounts): ${ err.message } with ${ nodes[0] }`);
            // Putting the node where the error comes from at the end of the array
            nodes.push(nodes.shift());
            steem.api.setOptions({ url: nodes[0] });
            if(log_errors) console.log(`Retrying with ${ nodes[0] }`);
            return updateNodes(callback);
        }
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
    broadcastDeleteComment,
    broadcastUpvote,
    getBalances,
    getContent,
    getFollowCircle,
    getLowestAsk,
    getTagsByAuthor,
    getTrendingTags,
    lookupAccountNames,
    updateNodes
}