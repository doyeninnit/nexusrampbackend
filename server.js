const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Binance = require('binance-api-node').default
const cors = require('cors');
const IntaSend = require('intasend-node');
const { ethers } = require('ethers');

// Private key of your hardcoded wallet - NEVER HARDCODE THIS, retrieve from environment variables
const HARDCODED_WALLET_PRIVATE_KEY = process.env.HARDCODED_WALLET_PRIVATE_KEY;

// USDT Contract details
const USDT_CONTRACT_ADDRESS = "0x14CE4c8E705531c3CbDDa925b9DeE6Df37aEE48e";
const USDT_ABI = [
    {
       "constant": false,
       "inputs": [
          {
             "name": "_to",
             "type": "address"
          },
          {
             "name": "_value",
             "type": "uint256"
          }
       ],
       "name": "transfer",
       "outputs": [
          {
             "name": "",
             "type": "bool"
          }
       ],
       "payable": false,
       "stateMutability": "nonpayable",
       "type": "function"
    }
 ];

// Set up a provider
const provider = new ethers.getDefaultProvider('goerli'); // Use 'rinkeby' for Rinkeby testnet etc.

// Set up a wallet instance from the private key
const hardcodedWallet = new ethers.Wallet(HARDCODED_WALLET_PRIVATE_KEY, provider);

// Create a new instance to interact with the USDT contract
const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, hardcodedWallet);


const app = express();
const port = 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
    // ... other configurations
}));
const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    // getTime: xxx,
})


app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Error constructing webhook event:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log("Completed purchase. Full session data:", JSON.stringify(session));
        console.log("completed purchase");

        // Extract crypto data from session metadata
        const cryptoAmount = session?.metadata?.cryptoAmount;
        const cryptoType = session?.metadata?.cryptoType;
        const walletAddress = session?.metadata?.walletAddress;
        
        if (cryptoAmount && cryptoType && walletAddress) {
            console.log(`Logged completed data = ${cryptoType}, ${cryptoAmount}`);
            
            // Check the crypto type and process accordingly
            if (cryptoType === 'USDT') {
                // Withdraw USDT to the provided wallet address
                try {
                    const withdrawalResult = await withdrawUSDT(walletAddress, parseFloat(cryptoAmount));
                    console.log("Withdrawal successful:", withdrawalResult);
                } catch (withdrawalError) {
                    console.error(`Failed to withdraw ${cryptoType}:`, withdrawalError.message);
                }
            } else {
                // Handle other cryptocurrencies here, if applicable
                console.error("Unsupported cryptocurrency type:", cryptoType);
            }

            return res.status(200).send('Received');
        } else {
            console.error("Unexpected session format. Could not extract crypto data.");
            return res.status(400).send("Unexpected session format. Could not extract crypto data.");
        }
    }

    console.error("Unhandled event type:", event.type);
    return res.status(400).send(`Unhandled event type: ${event.type}`);
});

// async function withdrawUSDT(address, amount) {
//     try {
//         const result = await client.withdraw({
//             asset: 'USDT',
//             address: address,
//             amount: amount
//         });
//         return result;
//     } catch (error) {
//         throw new Error(`Failed to withdraw USDT: ${error.message}`);
//     }
// }

async function withdrawUSDT(address, amount) {
    try {
        const amountInSmallestUnit = ethers.utils.parseUnits(amount.toString(), 6); // Convert to smallest unit

        // Send USDT from your hardcoded wallet to the provided address
        const tx = await usdtContract.transfer(address, amountInSmallestUnit);

        // Wait for the transaction to be mined and get its receipt
        const receipt = await tx.wait();
        console.log(receipt.transactionHash)
        return { success: true, txHash: receipt.transactionHash };
    } catch (error) {
        throw new Error(`Failed to withdraw USDT: ${error.message}`);
    }
}


async function buyAndTransferCrypto(cryptoAmount, symbol, walletAddress) {
    try {
        const orderResponse = await client.order({
            symbol: symbol,
            side: 'BUY',
            quantity: cryptoAmount,
            price: null, // For market orders, no price is needed
            type: 'MARKET'
        });

        console.log("Market Buy response", orderResponse);
        console.log("Order ID:", orderResponse.orderId);

        // After buying, transfer to the user's wallet
        // const walletAddress = "EXTRACTED_FROM_SESSION"; // Placeholder
        const amountToSend = orderResponse.executedQty;

        const withdrawalResponse = await client.withdraw({
            asset: cryptoType,
            address: walletAddress,
            amount: amountToSend,
            name: 'CryptoOnramp'
        });

        console.log("Withdraw response:", withdrawalResponse);

    } catch (error) {
        console.error('Error processing transaction:', error.body || error.message);
        // Handle error: maybe notify admin, retry, etc.
    }
}
;

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello, Crypto Onramp!');
});


app.post('/create-checkout-session', async (req, res) => {
    const { amount, walletAddress } = req.body;
    
    if (!amount || isNaN(amount)) {
        return res.status(400).send('Invalid amount provided');
    }
    const price = 1; 
    const totalAmount = amount * price;
    const unitAmt = totalAmount * 100;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${amount} USDT`,
                        description: `Buying ${amount} USDT for wallet: ${walletAddress}`,
                    },
                    unit_amount: parseInt(unitAmt, 10)
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: 'https://k-ramp-git-staging-griffins-sys254.vercel.app/success',
            cancel_url: 'https://k-ramp-git-staging-griffins-sys254.vercel.app/cancel',
            metadata: { // Adding metadata to store the custom data
                cryptoAmount: `${amount}`,
                cryptoType: 'USDT',
                walletAddress: `${walletAddress}`
            }
        });

        res.json({ sessionId: session.id });
        console.log(session.id);
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).send('Internal Server Error');
    }
});




app.listen(port, async () => {
    console.log(`Server started on http://localhost:${port}`);
    console.log(await client.ping())
    console.log(await client.time())

});
