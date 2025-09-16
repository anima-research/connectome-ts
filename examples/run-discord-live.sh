#!/bin/bash

# Discord AXON Live Test Runner
echo "🚀 Discord AXON Live Test"
echo "========================"
echo ""
echo "📋 Configuration:"
echo "- Guild ID: 1289595876716707911"
echo "- Bot Token: MTM4Mjg5MTcw... (from config)"
echo ""

# Export the guild ID
export DISCORD_GUILD_ID=1289595876716707911

# Check if server is running
echo "🔍 Checking Discord AXON server..."
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Server is already running"
else
    echo "❌ Server not running. Please start it first:"
    echo ""
    echo "In another terminal, run:"
    echo "cd examples/discord-axon-server"
    echo "npm install"
    echo 'DISCORD_BOT_TOKEN="...xaE" npm start'
    echo ""
    echo "Press Enter when server is running..."
    read
fi

echo ""
echo "🎮 Starting live test..."
echo ""

# Run the test
cd examples
node -r ts-node/register discord-live-test.ts
