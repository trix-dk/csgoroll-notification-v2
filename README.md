# CSGORoll Trade Notification Bot
![image](https://github.com/user-attachments/assets/6c55cc29-7281-4c57-9694-1f27a453bf42)

A Node.js bot that listens for CSGORoll trade events via WebSocket GraphQL subscriptions, processes trade data, calculates item real values using Buff prices and custom rate logic, and sends detailed notifications to Discord webhooks.

## Overview

This bot connects to the CSGORoll API to monitor real-time trade events for deposits and withdrawals. It:
- Subscribes to `createTrade` and `updateTrade` GraphQL events.
- Downloads and loads a `rates.json` file for custom rate calculations.
- Fetches live Buff prices to calculate the real value of traded items.
- Formats and sends trade details (including stickers, coin balance, and more) to specified Discord webhooks.
- Implements auto-reconnect functionality to maintain a stable WebSocket connection.

## Features

- **Real-Time Monitoring:** Listens to trade events (deposits and withdrawals) from CSGORoll.
- **Dynamic Pricing:** Calculates item values based on Buff prices and custom rates.
- **Detailed Discord Notifications:** Sends rich, formatted notifications with trade and user details.
- **Auto-Reconnect:** Automatically re-establishes WebSocket connections if they close or encounter errors.
- **Configurable:** Easily update your session cookie and Discord webhook URLs.

## Installation

### Prerequisites

- Node.js (v12 or later)
- npm

### Setup

1. **Clone the repository:**
   ```
   git clone https://github.com/trix-dk/csgoroll-notification-v2
   ```

2. **Navigate to the project directory:**
   ```
   cd csgoroll-notification-v2
   ```

3. **Install dependencies:**
   ```
   npm install
   ```

## Configuration

- **Session Cookie:**  
  Update the `cookie` variable in the source code with your CSGORoll session cookie:
  ```
  const cookie = "session=s%3A...";
  ```

- **Discord Webhooks:**  
  Update the `DiscordWithdrawWebhookUrl` and `DiscordDepositWebhookUrl` variables with your Discord webhook URLs:
  ```
  const DiscordWithdrawWebhookUrl = "https://discord.com/api/webhooks/your_withdraw_webhook";
  const DiscordDepositWebhookUrl = "https://discord.com/api/webhooks/your_deposit_webhook";
  ```

- **Rates File:**  
  The bot checks for a `rates.json` file on startup. If it doesn't exist or is empty, it downloads the file automatically from a predefined URL.

## Running the Bot

To start the bot, run:
```
node index.js
```
The bot will:
- Initialize by fetching your current user details.
- Establish a WebSocket connection to `wss://api-trader.csgoroll.com/graphql`.
- Subscribe to trade events and process them in real-time.
- Send formatted trade notifications to Discord.

## How It Works

1. **WebSocket Connection:**  
   Connects using a session cookie to subscribe to live trade events.

2. **GraphQL Subscriptions:**  
   Uses two subscriptions:
   - `OnCreateTrade` for new trades.
   - `OnUpdateTrade` for updated trades.

3. **Trade Processing:**  
   - Retrieves Buff prices from `https://prices.csgotrader.app/latest/buff163.json`.
   - Loads and applies custom rates from `rates.json`.
   - Calculates the "real value" of an item by comparing Buff prices with the trade’s value and markup.
   - Gathers additional details like sticker values and coin balances.

4. **Discord Notifications:**  
   Sends a rich embed message containing:
   - Trade type (Deposit/Withdraw)
   - Item details and calculated values
   - Sticker information (if available)
   - Timestamp and user balance

5. **Auto-Reconnect:**  
   In case of disconnections or errors, the bot queues and processes reconnection attempts automatically.

If you still need help contact me via discord: trix__dk (two underscores).

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/trix-dk/csgoroll-notification-v2/issues) if you want to contribute.
Special thanks to https://github.com/0xM14N for the rates.json <3
