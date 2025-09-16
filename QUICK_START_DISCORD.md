# Quick Start: Discord AXON Live Test

Your Guild ID: **1289595876716707911** ✅

## Step 1: Start Discord Server (Terminal 1)

```bash
cd examples/discord-axon-server
npm install
DISCORD_BOT_TOKEN="MTM4M...w0PQViQm3AaE" npm start
```

Wait until you see:
```
✅ Discord AXON Server is running!
```

## Step 2: Run Live Test (Terminal 2)

```bash
DISCORD_GUILD_ID=1289595876716707911 npm run discord:live
```

Or use the helper script:
```bash
./examples/run-discord-live.sh
```

## What Happens Next

1. **Bot connects** to your Discord server
2. **Lists channels** it can see
3. **Joins first channel** automatically
4. **Sends test message**: "Hello Discord! This is Connectome testing the AXON bridge. 🚀"
5. **Listens and responds** to:
   - Messages with "connectome"
   - Questions (?)
   - Greetings (hello, hi)

## Verify It's Working

Go to Discord and you should see:
- Bot is online (green dot)
- Test message in the channel
- Bot responds when you say "Hello!"

Press Ctrl+C to stop.

## Troubleshooting

If bot doesn't appear online:
- Check the bot is invited to server ID 1289595876716707911
- Verify bot has proper permissions

Ready? Let's go! 🚀
