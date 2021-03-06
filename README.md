# checky (0.3.2)
A Steem bot that checks if the users mentioned in a post exist on the blockchain. If they don't, it indicates to authors that they may have made a typo or it suggests them some existing usernames close to the wrong ones.

See this bot in action here: https://steemit.com/@checky/comments

## Deploy
**Required:** [Git](https://git-scm.com/), [NPM](https://www.npmjs.com/), [Node.js](https://nodejs.org/)<br>
While not recommended since [@checky](https://steemit.com/@checky) already uses this script, here is how you can deploy this bot yourself.
1. **Install**
```
git clone https://github.com/RagePeanut/checky.git
cd checky
npm install
```
2. **Set a CHECKY_PRIVATE_KEY environment variable**
3. **Start the bot**
```
npm start
```

## Configuration
You can change a few things in the **config.json** file, mainly for testing purposes.
* ***log_errors*** **-** whether or not you want to log Steem related errors (broadcast, stream and api) to the console (default: false).
* ***fail_safe_node*** **-** a safe node to use if @fullnodeupdate returns an empty array on its first call (default: https://api.steemit.com).
* ***test_environment*** **-** whether or not you are running the bot in a test environment, being in a test environment logs to the console instead of broadcasting to the blockchain (default: false).

## Commands
The following commands must be typed in reply to one of [@checky](https://steemit.com/@checky)'s posts or comments and not be preceded by any text to work.
* **!case** *[sensitive-insensitive]* **-** sets the case sensitivity of the mentions checking to *sensitive* (lowercase only) or *insensitive* (lowercase and uppercase).
* **!delay** *minutes* **-** tells the bot to wait X minutes before checking your posts.
* **!help** **-** gives a list of commands and their explanations.
* **!ignore** *username1* *username2* **-** tells  the bot to ignore some usernames mentioned in your posts (useful to avoid the bot mistaking other social network accounts for Steem accounts).
* **!mode** *[regular-advanced-off]* **-** sets the mentions checking to regular (only posts), advanced (posts and comments) or off (no checking). Alternatively, you can write *normal* or *on* instead of *regular*. You can also write *plus* instead of *advanced*.
* **!off -** shortcut for **!mode off**.
* **!on -** shortcut for **!mode on**.
* **!state** **-** gives the state of your account (*regular*, *advanced* or *off*).
* **!switch** *[regular-advanced-off]* **-** same as **!mode**.
* **!unignore** *username1* *username2* **-** tells the bot to unignore some usernames mentioned in your posts.
* **!wait** *minutes* **-** same as **!delay**.
* **!where** *username1* *username2* **-** asks the bot to show where in the post it found typos for the specified mentions. Alternatively, you can write this command with no parameters and it will show you where it found all the mentions with typos in them.

## Social networks
**Steemit:** https://steemit.com/@ragepeanut <br>
**Busy:** https://busy.org/@ragepeanut <br>
**Twitter:** [https://twitter.com/RagePeanut_](https://twitter.com/RagePeanut_) <br>
**Steam:** http://steamcommunity.com/id/ragepeanut/

### Follow me on [Steemit](https://steemit.com/@ragepeanut) or [Busy](https://busy.org/@ragepeanut) to be informed on my new releases and projects.
