const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const moment = require("moment-timezone");
const axios = require("axios");
const { exec } = require('child_process');
const fs = require('fs');

const cookie = ""; //put your csgoroll session cookie here, remember session= infront of the value!
const DiscordWithdrawWebhookUrl = ""; // put your discord withdraw webhook url here.
const DiscordDepositWebhookUrl = ""; // put your discord withdraw webhook url here.

const apiUrl = 'wss://api-trader.csgoroll.com/graphql';
let pingInterval;
let isStopped = false;
const activeSockets = new Map(); // Use a Map to track active sockets by cookie
let reconnectQueue = []; // Queue to manage reconnection tasks
let reconnecting = false; // Flag to indicate if reconnection is in progress
const BUFF_API_URL = "https://prices.csgotrader.app/latest/buff163.json";
let buffPrices = {};

// Ensure rates.json exists, otherwise download it
if (!fs.existsSync('./rates.json') || fs.readFileSync('./rates.json', 'utf8').trim() === '') {
  console.log('Downloading rates.json...');
  exec('curl -L -o rates.json https://raw.githubusercontent.com/trix-dk/csgoroll-notification-v2/main/rates.json', (error, stdout, stderr) => {
    if (error) {
      console.error('Failed to download rates.json:', error.message);
      process.exit(1);
    }
    console.log('rates.json downloaded successfully.');
    loadRates(); // Load rates after downloading
  });
} else {
  loadRates(); // Load rates if the file exists and is non-empty
}

// Load rates from local JSON file
function loadRates() {
  try {
    rates = JSON.parse(fs.readFileSync('./rates.json', 'utf8'));
    console.log("Rates loaded successfully.");
  } catch (error) {
    console.error("Error loading rates:", error.message);
  }
}

let config = {
  cookie: '',
  userId: null,
  discordWithdrawWebhookUrl: DiscordWithdrawWebhookUrl
};

// Function to fetch Buff prices
async function fetchBuffPrices() {
  try {
      const response = await axios.get(BUFF_API_URL);
      buffPrices = response.data;
      console.log("Buff prices updated successfully.");
  } catch (error) {
      console.error("Error fetching Buff prices:", error.message);
  }
}

function getBuffPrice(itemName) {
  try {
      if (!buffPrices || typeof buffPrices !== 'object') {
          console.error("Buff prices data is invalid or not loaded.");
          return null;
      }

      if (!itemName || typeof itemName !== 'string') {
          console.error("Item name is invalid.");
          return null;
      }

      // Match items like Doppler, Gamma Doppler, and phases
      const specialItemMatch = itemName.match(/★ (StatTrak™ )?([\w\s]+) \| (Doppler|Gamma Doppler|Ruby|Sapphire|Emerald|Black Pearl)(?: (Phase \d+))? \((.*?)\)/);

      if (specialItemMatch) {
          let itemType = `★ ${specialItemMatch[2].trim()}`; // Example: "★ M9 Bayonet"
          let finish = specialItemMatch[3].trim(); // Example: "Doppler", "Gamma Doppler", "Sapphire"
          let phase = specialItemMatch[4]?.trim(); // Example: "Phase 1"
          let wear = specialItemMatch[5].trim(); // Example: "Factory New"

          // Adjust naming to match Buff JSON structure
          let buffFinish = finish;
          if (["Sapphire", "Ruby", "Emerald", "Black Pearl"].includes(finish)) {
              buffFinish = "Doppler"; // Buff stores these under "Doppler"
          }

          let key = `${itemType} | ${buffFinish} (${wear})`;

          const itemData = buffPrices[key];
          if (!itemData) {
              console.warn(`No pricing data found for key: ${key}`);
              return null;
          }

          let price = null;
          const dopplerPrices = itemData?.starting_at?.doppler;

          if (dopplerPrices) {
              if (["Ruby", "Sapphire", "Emerald", "Black Pearl"].includes(finish)) {
                  price = parseFloat(dopplerPrices[finish]); // Use exact finish price
              } else if ((finish === "Doppler" || finish === "Gamma Doppler") && phase) {
                  price = parseFloat(dopplerPrices[phase]); // Use phase-specific pricing
              }
          }

          // Fallback to default price
          if (!price) {
              price = parseFloat(itemData?.starting_at?.price);
          }

          if (!price || isNaN(price)) {
              console.warn(`Invalid or missing price for item: ${itemName}`);
              return null;
          }

          return price;
      }

      // Fallback for non-special items
      let key = itemName.trim();

      const itemData = buffPrices[key];
      if (!itemData) {
          console.warn(`No pricing data found for item: ${itemName}`);
          return null;
      }

      const price = parseFloat(itemData?.starting_at?.price);
      if (!price || isNaN(price)) {
          console.warn(`Invalid or missing price for item: ${itemName}`);
          return null;
      }

      return price;
  } catch (error) {
      console.error(`Error fetching Buff price for item: ${itemName}, error:`, error);
      return null;
  }
}

function getItemRate(itemName) {
  // Updated regex for matching special knives
  const specialItemMatch = itemName.match(/★ (StatTrak™ )?([\w\s]+) \| (Doppler|Gamma Doppler|Ruby|Sapphire|Emerald|Black Pearl)(?: (Phase \d+))? \((.*?)\)/);
  
  if (specialItemMatch) {
      const isStatTrak = !!specialItemMatch[1]; // Detect if it's StatTrak
      const wear = specialItemMatch[5]?.trim(); // Extract wear condition (e.g., Factory New)

      // Apply special rate for Factory New, non-StatTrak items
      if (!isStatTrak && wear === "Factory New") {
          return 0.65;
      }
  }

  // Default to existing rate lookup or fallback to 0.66
  return rates[itemName]?.rate || 0.66;
}

const fetchCurrentUser = async (cookie) => {
  const session = cookie.startsWith('session=') ? cookie : `session=${cookie}`;
  const variables = {}; // No variables for the `CurrentUser` query
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: "48577735febce2a02a4c28137987973c7e165d174978b6aa20b768223b1bf9ce",
    },
  };

  try {
    const response = await axios({
      method: 'get',
      url: decodeGraphqlUrl('CurrentUser', variables, extensions),
      headers: { "Cookie": session },
      timeout: 30000, // Set timeout to 30 seconds (30000 milliseconds)
    });

    if (response.data && response.data.data && response.data.data.currentUser) {
      const userData = response.data.data.currentUser;
      const userId = userData.id || null;
      const wallets = userData.wallets || [];
      const mainWallet = wallets.find(wallet => wallet.name === "MAIN") || wallets[0];
      const mainWalletBalance = mainWallet ? mainWallet.amount : null;

      return { userId, mainWalletBalance };
    } else {
      console.error('Invalid response format:', response.data);
      return { userId: null, mainWalletBalance: null };
    }
  } catch (error) {
    console.error("Error fetching current user:", error.message);
    return { userId: null, mainWalletBalance: null };
  }
};

// Decode GraphQL URL Function
const decodeGraphqlUrl = (operationName, variables, extensions) => {
    return 'https://api-trader.csgoroll.com/graphql?operationName=' + operationName + '&variables=' + encodeURIComponent(JSON.stringify(variables))
        + '&extensions=' + encodeURIComponent(JSON.stringify(extensions));
};


const createTradePayload = {
  id: uuidv4(),
  type: "subscribe",
  payload: {
    query: `subscription OnCreateTrade {
      createTrade {
        trade {
          id
          status
          depositor {
            id
            steamId
            displayName
            __typename
          }
          withdrawer {
            id
            steamId
            displayName
            __typename
          }
          tradeItems {
            marketName
            value
            markupPercent
            itemVariant {
              iconUrl
              name
            }
            stickers {
              wear
              value
              name
              color
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }`
  }
};

const updateTradePayload = {
  id: uuidv4(),
  type: "subscribe",
  payload: {
    query: `subscription OnUpdateTrade {
      updateTrade {
        trade {
          id
          status
          depositor {
            id
            steamId
            displayName
            __typename
          }
          withdrawer {
            id
            steamId
            displayName
            __typename
          }
         tradeItems {
            marketName
            value
            markupPercent
            itemVariant {
              iconUrl
              name
            }
            stickers {
              wear
              value
              name
              color
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }`
  }
};


function calculateTotalStickerValue(stickers) {
  return stickers.reduce((total, sticker) => total + (sticker.wear === 0 ? sticker.value || 0 : 0), 0);
}

function formatStickers(stickers) {
  return stickers.map(sticker => {
    const stickerInfo = sticker.color ? `${sticker.color} ${sticker.name}` : `${sticker.name}`;
    return sticker.wear === 0 ? `${stickerInfo} Value: ${sticker.value}` : `${stickerInfo} (scraped) Value: ${sticker.value}`;
  }).join('\n');
}

async function sendToDiscord(tradeData, webhookUrl) {
  const {
    tradeType,
    status,
    marketName,
    value,
    markup,
    totalStickerValue,
    stickers,
    coinBalance,
    depositor,
    buffPrice,
    rate,
    realValue,
    iconUrl,
  } = tradeData;

  const timestamp = moment().tz('Europe/Berlin').format('YYYY-MM-DD HH:mm:ss');
  const formattedStickers = stickers.length > 0 ? formatStickers(stickers) : null;

  const percentageDifference = realValue && realValue !== 'N/A'
    ? ((value / realValue) * 100).toFixed(2)
    : null;

  const embed = {
    embeds: [
      {
        title: `${tradeType} Trade`,
        description: `**Status**: ${status}`,
        color: tradeType === 'Deposit' ? 15158332 : 3066993,
        fields: [
          { name: 'Item', value: `${marketName || '-'}`, inline: false },
          { name: 'Roll Value', value: `${value ? value.toFixed(2) : '-'}`, inline: true },
          { name: 'Markup', value: `${markup ? `${markup.toFixed(2)}%` : '0%'}`, inline: true },
          {
            name: 'Real Value',
            value: realValue && !isNaN(realValue)
              ? `${realValue.toFixed(2)} (${percentageDifference}%)\nBuff: ${buffPrice && !isNaN(buffPrice) ? buffPrice.toFixed(2) : 'N/A'}$ / Rate: ${rate || 'N/A'}`
              : 'N/A',
            inline: false,
          },
        ],
        footer: {
          text: `Timestamp: ${timestamp}`,
        },
        thumbnail: {
          url: iconUrl || 'https://via.placeholder.com/150',
        },
      },
    ],
  };

  if (stickers.length > 0) {
    embed.embeds[0].fields.push(
      { name: 'Stickers', value: formattedStickers || '-', inline: false },
      { name: 'Total Sticker Value', value: `${totalStickerValue.toFixed(2)}`, inline: false }
    );
  }

  // For withdraws include depositor info; for deposits, omit depositor user id and username.
  if (tradeType === 'Withdraw') {
    embed.embeds[0].fields.push({
      name: 'Depositor Info',
      value: `**Roll ID**: ${depositor?.id || 'Unknown'}\n**Roll Name**: ${depositor?.displayName || 'Unknown'}`,
      inline: false,
    });
  }
  embed.embeds[0].fields.push(
    { name: 'Balance', value: `${coinBalance ? coinBalance.toFixed(2) : '-'}`, inline: true }
  );

  try {
    await axios.post(webhookUrl, embed);
  } catch (error) {
    console.error('Error sending to Discord:', error.response?.data || error.message);
  }  
}  

// Modified handleTrade to process both withdrawals and deposits
async function handleTrade(trade, cookie) {
  const withdrawer = trade.withdrawer || {};
  const depositor = trade.depositor || {};
  const item = trade.tradeItems && trade.tradeItems[0];

  // Check if current user is involved as withdrawer or depositor
  const isWithdraw = config.userId && config.userId.includes(withdrawer.id);
  const isDeposit = config.userId && config.userId.includes(depositor.id);

  if (!isWithdraw && !isDeposit) return;
  if (trade.status === 'listed') return;
  if (!item) return;

  const value = item.value || 0;
  const markup = item.markupPercent || 0;
  const stickers = item.stickers || [];
  const totalStickerValue = calculateTotalStickerValue(stickers);

  let coinBalance = null;
  try {
    const userData = await fetchCurrentUser(cookie);
    coinBalance = userData.mainWalletBalance;
  } catch (error) {
    console.error("Error fetching coin balance:", error.message);
    coinBalance = 'Unknown';
  }

  const buffPrice = getBuffPrice(item.marketName);
  const rate = getItemRate(item.marketName);
  const realValue = buffPrice ? buffPrice / rate : null;
  const iconUrl = item.itemVariant?.iconUrl || null;

  const tradeData = {
    tradeType: isWithdraw ? 'Withdraw' : 'Deposit',
    status: trade.status,
    marketName: item.marketName || '-',
    value,
    markup,
    totalStickerValue,
    stickers,
    coinBalance,
    // For withdrawals, include depositor info; for deposits, leave it undefined
    depositor: isWithdraw ? depositor : undefined,
    iconUrl,
    timestamp: moment().tz('Europe/Berlin').format('YYYY-MM-DD HH:mm:ss'),
    buffPrice: buffPrice || 'N/A',
    rate: rate || 0.66,
    realValue: realValue || 'N/A',
  };

  const webhookUrl = isWithdraw ? config.discordWithdrawWebhookUrl : DiscordDepositWebhookUrl;
  await sendToDiscord(tradeData, webhookUrl);
}

function enqueueReconnect(cookie) {
  if (isStopped) {
    console.log(`Reconnect aborted for cookie: ${cookie} as bot is stopped.`);
    return;
  }
  if (!reconnectQueue.includes(cookie)) {
    reconnectQueue.push(cookie); // Add the cookie to the reconnect queue if not already present
  }
  processReconnectQueue(); // Ensure the queue is processed
}

function connectSocket(cookie) {
  if (activeSockets.has(cookie)) {
      console.log(`WebSocket already active for cookie: ${cookie}`);
      return;
  }

  const socket = new WebSocket(apiUrl, 'graphql-transport-ws', {
      headers: {
          'Cookie': cookie,
          "Sec-WebSocket-Protocol": "graphql-transport-ws",
          "Sec-WebSocket-Version": 13,
          "Upgrade": "websocket",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 OPR/100.0.0.0"
      }
  });

  socket.on('open', () => {
    console.log("Websocket Opened!");
    activeSockets.set(cookie, socket); // Track the socket by cookie
  
      // Send initialization payloads
      setTimeout(() => socket.send(JSON.stringify({ type: 'connection_init' })), 250);
      setTimeout(() => socket.send(JSON.stringify(createTradePayload)), 500);
      setTimeout(() => socket.send(JSON.stringify(updateTradePayload)), 750);
  
      // Start ping interval to keep connection alive
      clearInterval(pingInterval);
  
      // Delay the first ping by 2 seconds
      setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping' }));
          }
          // Start the regular ping interval
          pingInterval = setInterval(() => {
              if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: 'ping' }));
              }
          }, 60 * 1000); // Ping every 60 seconds
      }, 2000); // Delay of 2 seconds
  });  

    socket.on('message', async (data) => {
        const message = JSON.parse(data);
        const trade = message.payload?.data?.createTrade?.trade || message.payload?.data?.updateTrade?.trade;
        if (trade) {
            await handleTrade(trade, cookie); // Pass cookie to handleTrade
        }
    });

    socket.on('close', () => {
      console.log("Websocket Closed!");
      clearInterval(pingInterval); // Clear the ping interval for this socket
      activeSockets.delete(cookie); // Remove the socket from the active list
      enqueueReconnect(cookie);
  });

    socket.on('error', (error) => {
      console.error(`WebSocket error for cookie: ${cookie}`, error);
      clearInterval(pingInterval); // Clear the ping interval for this socket
      activeSockets.delete(cookie); // Remove the socket from the active list
      socket.close();
      enqueueReconnect(cookie);
  });
} 

async function processReconnectQueue() {
  if (isStopped || reconnecting || reconnectQueue.length === 0) return;

  reconnecting = true; // Mark as reconnecting

  const cookieToReconnect = reconnectQueue.shift(); // Remove the cookie from the queue
  console.log(`Attempting to reconnect for cookie: ${cookieToReconnect}`);

  connectSocket(cookieToReconnect); // Reconnect the socket

  // Wait 7.5 seconds before processing the next item
  setTimeout(() => {
    reconnecting = false; // Mark as not reconnecting
    processReconnectQueue(); // Continue processing the queue
  }, 7500);
}

async function initializeBot() {
  try {
    const userData = await fetchCurrentUser(cookie);
    if (userData.userId) {
      config.userId = [userData.userId];
      config.cookie = cookie;
      console.log(`Bot initialized with userId: ${config.userId}`);
      enqueueReconnect(cookie);
    } else {
      console.error("Failed to fetch userId. Please check the cookie.");
    }
  } catch (error) {
    console.error("Error initializing bot:", error.message);
  }
}

setInterval(fetchBuffPrices, 6 * 60 * 60 * 1000);
fetchBuffPrices(); // Initial fetch
initializeBot();
