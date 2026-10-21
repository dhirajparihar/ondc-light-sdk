/**
 * Express Seller Application Example
 * Demonstrates a production-ready ONDC Seller Node using ondc-light-sdk.
 *
 * Exposes:
 * - POST /ondc/search: Primary entry point for ONDC Gateway / BAP search queries
 * - POST /mock-bap/on_search: Mock BAP receiver demonstrating signature verification
 * - GET  /trigger-test-search: Helper route to simulate an incoming search request
 */

import express from 'express';
import { OndcSellerNode, verifyAuthorizationHeader } from '../../dist/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse standard JSON bodies
app.use(express.json());

// 1. Initialize OndcSellerNode with staging credentials
const STAGING_CONFIG = {
  subscriberId: 'seller-store.staging.ondc.org',
  uniqueKeyId: 'seller-key-2026',
  publicKey: 'W0Kd5MZ4DTWoMn7MuHoTazo9XXp2WDOZO+rULYOkRqM=',
  privateKey:
    'zkHPam4DTZ42+CSeAiRlAA4xfvKnsgX8nenPl58leORbQp3kxngNNagyfsy4ehNrOj1denZYM5k76tQtg6RGow==',
  gatewayUrl: 'https://staging.gateway.ondc.org',
  bppId: 'seller-store.staging.ondc.org',
  bppUri: `http://localhost:${PORT}/ondc`,
  domain: 'ONDC:RET10',
  country: 'IND',
  city: 'std:080',
  ttl: 'PT30S',
};

const sellerNode = new OndcSellerNode(STAGING_CONFIG);

// 2. Static mock product catalog
const MOCK_CATALOG = [
  {
    id: 'SKU-ATTA-001',
    name: 'Aashirvaad Superior MP Atta (5kg)',
    price: 275.0,
    currency: 'INR',
    description: '100% pure whole wheat grain flour with natural dietary fiber.',
    longDescription:
      'Aashirvaad Whole Wheat Atta is made from the grains which are heavy on the palm, golden amber in colour and hard in bite.',
    images: ['https://cdn.example.com/products/atta-5kg.jpg'],
    categoryId: 'Grocery & Staples',
    availableQty: 120,
  },
  {
    id: 'SKU-COFFEE-002',
    name: 'Araku Valley Organic Arabica Filter Coffee (250g)',
    price: 340.0,
    currency: 'INR',
    description: 'Freshly roasted single-origin shade-grown filter coffee powder.',
    longDescription:
      'Grown by tribal farmers in the Eastern Ghats of India, medium roasted to preserve chocolate and citrus undertones.',
    images: ['https://cdn.example.com/products/araku-coffee.jpg'],
    categoryId: 'Beverages',
    availableQty: 45,
  },
  {
    id: 'SKU-RICE-003',
    name: 'Daawat Rozana Super Basmati Rice (5kg)',
    price: 495.0,
    currency: 'INR',
    description: 'Aromatic aged long grain basmati rice for daily delicacies.',
    longDescription:
      'Pearlescent grains that cook to fluffy perfection without sticking. Ideal for biryanis, pulao, and steamed rice dishes.',
    images: ['https://cdn.example.com/products/basmati-rice.jpg'],
    categoryId: 'Grocery & Staples',
    availableQty: 80,
  },
  {
    id: 'SKU-OIL-004',
    name: 'Cold Pressed Wood-Churned Mustard Oil (1L)',
    price: 220.0,
    currency: 'INR',
    description: 'Traditional kachi ghani unrefined mustard oil rich in omega-3.',
    longDescription:
      'Extracted from handpicked black mustard seeds using traditional wooden kolhus at cold temperatures.',
    images: ['https://cdn.example.com/products/mustard-oil.jpg'],
    categoryId: 'Cooking Oils',
    availableQty: 60,
  },
];

/**
 * Filter products according to search intent (query string, item name, or category)
 */
function searchCatalog(searchIntent) {
  if (!searchIntent) {
    return MOCK_CATALOG;
  }

  const queryTerm = (
    searchIntent.item?.descriptor?.name ||
    searchIntent.category?.descriptor?.name ||
    searchIntent.provider?.descriptor?.name ||
    ''
  )
    .trim()
    .toLowerCase();

  if (!queryTerm) {
    return MOCK_CATALOG;
  }

  const matched = MOCK_CATALOG.filter((item) => {
    return (
      item.name.toLowerCase().includes(queryTerm) ||
      item.description.toLowerCase().includes(queryTerm) ||
      item.categoryId.toLowerCase().includes(queryTerm)
    );
  });

  return matched.length > 0 ? matched : MOCK_CATALOG;
}

// 3. Live POST router endpoint at /ondc/search
app.post('/ondc/search', async (req, res) => {
  console.log('\n==================== [ONDC INCOMING /search] ====================');

  try {
    // Intercept and parse incoming gateway web request bundle
    const parsedRequest = sellerNode.parseIncomingRequest(req);

    const { transactionId, messageId, searchIntent, bapUri, bapId } = parsedRequest;

    console.log('[SDK] Parsed Request Context:');
    console.log(`  - Transaction ID : ${transactionId}`);
    console.log(`  - Message ID     : ${messageId}`);
    console.log(`  - BAP URI        : ${bapUri}`);
    console.log(`  - BAP ID         : ${bapId}`);
    console.log(`  - Search Intent  :`, JSON.stringify(searchIntent, null, 2));

    // Acknowledge the search request immediately as required by Beckn specifications
    res.status(200).json({
      message: {
        ack: {
          status: 'ACK',
        },
      },
    });

    // Query local catalog matching the requested search intent
    const matchedProducts = searchCatalog(searchIntent);
    console.log(
      `[Catalog] Found ${matchedProducts.length} matching products for query.`
    );

    // Asynchronously dispatch the fully signed on_search Beckn JSON package
    setImmediate(async () => {
      try {
        console.log(`[SDK] Dispatching signed on_search callback to: ${bapUri}/on_search`);
        const dispatchResult = await sellerNode.sendOnSearch({
          transactionId,
          messageId,
          bapUri,
          bapId,
          items: matchedProducts,
          providerId: 'SELLER-STORE-01',
          providerName: 'Bharat Direct Grocery Store',
        });

        console.log('[SDK] on_search dispatch completed successfully.');
        console.log(`  - Target URL : ${dispatchResult.targetUrl}`);
        console.log(`  - HTTP Status: ${dispatchResult.status}`);
      } catch (dispatchError) {
        console.error('[SDK] Error dispatching on_search payload:', dispatchError.message);
      }
    });
  } catch (error) {
    console.error('[SDK] Failed to parse incoming request:', error.message);
    res.status(400).json({
      message: {
        ack: {
          status: 'NACK',
        },
      },
      error: {
        type: 'CONTEXT-ERROR',
        code: '10001',
        message: error.message,
      },
    });
  }
});

// 4. Mock BAP receiver endpoint to verify signed /on_search calls locally
app.post('/mock-bap/on_search', async (req, res) => {
  console.log('\n==================== [MOCK BAP RECEIVED /on_search] ====================');
  const authHeader = req.headers.authorization || req.headers.Authorization;

  console.log('[Mock BAP] Authorization Header:');
  console.log(`  ${authHeader || '(Missing)'}`);

  let isVerified = false;
  if (authHeader) {
    isVerified = await verifyAuthorizationHeader({
      header: authHeader,
      body: req.body,
      publicKey: STAGING_CONFIG.publicKey,
    });
  }

  console.log(`[Mock BAP] Cryptographic Signature Valid: ${isVerified ? '✅ VERIFIED' : '❌ FAILED'}`);

  const items =
    req.body?.message?.catalog?.['bpp/providers']?.[0]?.items || [];
  console.log(`[Mock BAP] Received Catalog Item Count: ${items.length}`);
  items.forEach((item, index) => {
    console.log(`  [${index + 1}] ${item.descriptor?.name} - ₹${item.price?.value}`);
  });

  res.status(200).json({
    message: {
      ack: {
        status: 'ACK',
      },
    },
    verification: {
      signatureValid: isVerified,
    },
  });
});

// 5. Helper route to trigger a mock search locally via GET browser request or curl
app.get('/trigger-test-search', async (req, res) => {
  const query = req.query.q || 'atta';
  console.log(`\n[Trigger] Initiating simulated gateway search for term: "${query}"`);

  const mockGatewayPayload = {
    context: {
      domain: 'ONDC:RET10',
      country: 'IND',
      city: 'std:080',
      action: 'search',
      core_version: '1.2.0',
      bap_id: 'buyer-app.staging.ondc.org',
      bap_uri: `http://localhost:${PORT}/mock-bap`,
      transaction_id: `txn_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      message_id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      ttl: 'PT30S',
    },
    message: {
      intent: {
        item: {
          descriptor: {
            name: query,
          },
        },
        fulfillment: {
          type: 'Delivery',
          end: {
            location: {
              gps: '12.9715987,77.5945627',
              address: {
                area_code: '560001',
              },
            },
          },
        },
      },
    },
  };

  try {
    const fetchResponse = await fetch(`http://localhost:${PORT}/ondc/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockGatewayPayload),
    });

    const responseJson = await fetchResponse.json();
    res.json({
      status: 'Triggered search request successfully',
      sentPayload: mockGatewayPayload,
      gatewayResponse: responseJson,
      message: 'Check console logs to observe the /ondc/search and signed /on_search cycle in action!',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Start the server
const server = app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`  ONDC Seller Node running on http://localhost:${PORT}`);
  console.log(`  - POST /ondc/search         : Main ONDC Search Endpoint`);
  console.log(`  - POST /mock-bap/on_search  : Mock BAP Receiver Endpoint`);
  console.log(`  - GET  /trigger-test-search : Simulate Search Cycle (e.g. ?q=coffee)`);
  console.log(`================================================================`);
});

export { app, server };
