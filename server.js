const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Binance = require('binance-api-node').default
const cors = require('cors');
const IntaSend = require('intasend-node');


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


// app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
//     const sig = req.headers['stripe-signature'];
//     let event;

//     try {
//         event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//     } catch (err) {
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     if (event.type === 'checkout.session.completed') {
//         const session = event.data.object;
//        console.log("completed purchase")
//         // TODO: Purchase crypto via Binance here
//         // Extract crypto type, amount, and wallet address from session
//         const [cryptoAmount, cryptoType] = session.display_items[0].description.split(" ");
//      console.log('logged completed data = '`${cryptoType}, ${cryptoAmount}`)
//         // For demonstration purposes, we'll consider a market buy order.
//         const symbol = cryptoType === 'ETH' ? 'ETHUSDT' : 'USDTUSDT'; // Use appropriate trading pair
//     }

//     buyAndTransferCrypto(cryptoAmount, symbol)

//     res.status(200).send('Received');
// });

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

        console.log("completed purchase");

        // Safely access the description
        const description = session?.display_items?.[0]?.description;
        
        if (description) {
            const [cryptoAmount, cryptoType] = description.split(" ");

            if (cryptoAmount && cryptoType) {
                console.log(`Logged completed data = ${cryptoType}, ${cryptoAmount}`);
                
                const symbol = cryptoType === 'ETH' ? 'ETHUSDT' : 'USDTUSDT'; // Use appropriate trading pair
                
                // Buy and transfer crypto
                buyAndTransferCrypto(cryptoAmount, symbol);

                return res.status(200).send('Received');
            }
        }
        
        console.error("Unexpected session format. Could not extract crypto data.");
        return res.status(400).send("Unexpected session format. Could not extract crypto data.");
    }

    console.error("Unhandled event type:", event.type);
    return res.status(400).send(`Unhandled event type: ${event.type}`);
});


async function buyAndTransferCrypto(cryptoAmount, symbol) {
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
        const walletAddress = "EXTRACTED_FROM_SESSION"; // Placeholder
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
// const intasend = new IntaSend({
//     publishable_key: 'ISPubKey_test_a221dee2-8882-494c-887c-5934e26e8123',
//     // secret_key: 'ISSecretKey_test_922fc0a6-19a9-46e4-9543-22e66e727cfe',
//     test_mode: true // set to false when going live
// });

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello, Crypto Onramp!');
});

app.post('/create-checkout-session', async (req, res) => {
    // const { cryptoType, cryptoAmount, walletAddress } = req.body;
    const { amount, walletAddress } = req.body; // Corrected data destructuring
    if (!amount || isNaN(amount)) {
        return res.status(400).send('Invalid amount provided');
    }
    // For demonstration purposes, let's assume a fixed price. In a real-world scenario, you'd fetch current crypto prices.
    // const price = cryptoType === 'ETH' ? 2000 : 1; // Replace with dynamic pricing logic
    // const totalAmount = cryptoAmount * price;
    // const unitAmt = totalAmount * 100

    // For demonstration purposes, let's assume a fixed price and crypto type
    const price = 2000; // Replace with dynamic pricing logic
    const totalAmount = amount * price;
    const unitAmt = totalAmount * 100;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        // name: `${cryptoAmount} ${cryptoType}`,
                        // description: `Buying ${cryptoAmount} ${cryptoType} for wallet: ${walletAddress}`,
                        name: `${amount} ETH`, // Here I assume you're only dealing with ETH as a placeholder
                        description: `Buying ${amount} ETH for wallet: ${walletAddress}`,

                    },
                    // unit_amount: totalAmount * 100, // Stripe uses cents, hence multiplying by 100
                    unit_amount: parseInt(unitAmt, 10)

                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: 'https://k-ramp-git-staging-griffins-sys254.vercel.app/success',
            cancel_url: 'https://k-ramp-git-staging-griffins-sys254.vercel.app/cancel',
        });

        res.json({ sessionId: session.id });
        console.log(session.id)
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).send('Internal Server Error');
    }
});


// app.post('/mpesa-stk-push', (req, res) => {
//     // const { first_name, last_name, email, host, amount, phone_number, api_ref } = req.body;

//     // Validate request data here if necessary
//     console.log("1")
//     let collection = intasend.collection();
//     console.log("2")

//     collection.mpesaStkPush({
//         // first_name,
//         // last_name,
//         // email,
//         // host,
//         // amount,
//         // phone_number,
//         // api_ref
//         first_name: 'Nashons',
//         last_name: 'Agate',
//         email: 'agatenashons@gmail.com',
//         host: 'https://www.swypt.io/',
//         amount: 10,
//         phone_number: '254796448347',
//         api_ref: 'test',
//     })

//     console.log("3")

//         .then((resp) => {
//             res.json({
//                 message: 'STK Push Successful',
//                 data: resp
//             });
//         })
//         .catch((err) => {
//             // console.error('STK Push Resp error:', err);
//             console.error('STK Push Resp error:', err.toString('utf8'));
//             res.status(500).json({
//                 message: 'STK Push Failed',
//                 error: err.message
//             });
//         });
// });


app.listen(port, async () => {
    console.log(`Server started on http://localhost:${port}`);
    console.log(await client.ping())
    console.log(await client.time())
    // console.log(
    //     await client.order({
    //       symbol: 'XLMETH',
    //       side: 'BUY',
    //       quantity: '100',
    //       price: '0.0002',
    //     }),
    //   )


});
