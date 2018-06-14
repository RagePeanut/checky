const steem = require('steem');
stream();
function stream() {
    new Promise((resolve, reject) => {
        steem.api.streamOperations('irreversible', (error, operation) => {
            if(error) return reject(error);
            if(operation[0] == 'comment') {
                let metadata;
                try {
                    metadata = JSON.parse(operation[1].json_metadata);
                    // Removing empty strings
                    const mentions = metadata.users.filter(user => user !== '')
                    // Removing the dots at the end of some mentions (happens with Busy)
                                                   .map(user => user.replace(/\.+$/, ''))
                    // Removing website names
                                                   .filter(user => user.length < 5 || !/\.[a-z]{2,3}$/.test(user))
                    // Lower casing the characters
                                                   .map(user => user.toLowerCase());
                    steem.api.lookupAccountNames(mentions, (err, res) => {
                        if(err) throw err;
                        const wrongMentions = [];
                        // Add each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
                        for(let i = 0; i < mentions.length; i++) {
                            if(res[i] === null) wrongMentions.push('@' + mentions[i]);
                        }
                        if(wrongMentions.length > 0) {
                            const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\/])(?:' + wrongMentions.join('|') + ')(?:[^\\/][\\s\\S]{0,299}|$)', 'g');
                            const matches = operation[1].body.match(regex)
                            if(matches) {
                                let socialNetworkRelated;
                                matches.forEach(part => {
                                    socialNetworkRelated = socialNetworkRelated || /instagram|tw(itter|eet)|medium/i.test(part);
                                });
                                if(!socialNetworkRelated) {
                                    console.log(`Hi, while checking the users mentioned in this post I noticed that ${ wrongMentions.join(', ') } ${ wrongMentions.length > 1 ? 'don\'t' : 'doesn\'t' } exist. Maybe you made a typo ?`);
                                }
                                console.log(wrongMentions, operation[1].author, operation[1].permlink);
                            } else console.log(matches);
                        }
                    });
                } catch(err) {}
            }
        });
    }).catch(error => {
        console.log(error.message);
        stream();
    })
}