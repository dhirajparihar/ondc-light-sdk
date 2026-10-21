import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  OndcCrypto,
  OndcSellerNode,
  generateAuthorizationHeader,
  verifyAuthorizationHeader,
  generateKeyPair,
  parseAuthorizationHeader,
} from '../dist/index.js';

describe('ONDC Light SDK - OndcCrypto Engine', () => {
  let keyPair;

  before(async () => {
    keyPair = await generateKeyPair();
  });

  test('should generate valid Ed25519 keypair in base64 format', () => {
    assert.ok(keyPair.publicKey, 'Public key must be defined');
    assert.ok(keyPair.privateKey, 'Private key must be defined');
    assert.equal(keyPair.keyType, 'ed25519');

    // 32-byte public key in base64 is 44 characters
    assert.equal(Buffer.from(keyPair.publicKey, 'base64').length, 32);
    // 64-byte secret key in base64 is 88 characters
    assert.equal(Buffer.from(keyPair.privateKey, 'base64').length, 64);
  });

  test('should generate compliant ONDC Authorization header', async () => {
    const body = {
      context: { action: 'search', transaction_id: 'txn-101' },
      message: { intent: { item: { descriptor: { name: 'coffee' } } } },
    };

    const header = await generateAuthorizationHeader({
      body,
      privateKey: keyPair.privateKey,
      subscriberId: 'seller.domain.org',
      uniqueKeyId: 'key-101',
      ttl: 300,
    });

    assert.ok(header.startsWith('Signature '), 'Header must start with Signature');
    assert.match(header, /username="seller\.domain\.org\|key-101\|ed25519"/);
    assert.match(header, /algorithm="ed25519"/);
    assert.match(header, /created="\d+"/);
    assert.match(header, /expires="\d+"/);
    assert.match(header, /headers="\(created\) \(expires\) digest"/);
    assert.match(header, /signature="[A-Za-z0-9+/=]+"/);
  });

  test('should parse and cryptographically verify signature against unmodified payload', async () => {
    const body = {
      context: { action: 'on_search', transaction_id: 'txn-202' },
      message: { catalog: { 'bpp/providers': [] } },
    };

    const header = await generateAuthorizationHeader({
      body,
      privateKey: keyPair.privateKey,
      subscriberId: 'seller.domain.org',
      uniqueKeyId: 'key-101',
      ttl: 300,
    });

    const parsed = parseAuthorizationHeader(header);
    assert.equal(parsed.subscriberId, 'seller.domain.org');
    assert.equal(parsed.uniqueKeyId, 'key-101');
    assert.equal(parsed.algorithm, 'ed25519');

    const isValid = await verifyAuthorizationHeader({
      header,
      body,
      publicKey: keyPair.publicKey,
    });

    assert.equal(isValid, true, 'Valid signature must verify successfully');
  });

  test('should reject signature if payload was tampered with', async () => {
    const originalBody = {
      context: { action: 'search', transaction_id: 'txn-303' },
      message: { intent: { item: { descriptor: { name: 'tea' } } } },
    };

    const header = await generateAuthorizationHeader({
      body: originalBody,
      privateKey: keyPair.privateKey,
      subscriberId: 'seller.domain.org',
      uniqueKeyId: 'key-101',
    });

    const tamperedBody = {
      context: { action: 'search', transaction_id: 'txn-303' },
      message: { intent: { item: { descriptor: { name: 'tampered-item' } } } },
    };

    const isValid = await verifyAuthorizationHeader({
      header,
      body: tamperedBody,
      publicKey: keyPair.publicKey,
    });

    assert.equal(isValid, false, 'Tampered payload must fail cryptographic verification');
  });

  test('should reject signature if expired', async () => {
    const body = { test: 'expired-test' };
    const pastTime = Math.floor(Date.now() / 1000) - 1000;

    const header = await generateAuthorizationHeader({
      body,
      privateKey: keyPair.privateKey,
      subscriberId: 'seller.domain.org',
      uniqueKeyId: 'key-101',
      created: pastTime,
      ttl: 60, // expired ~940 seconds ago
    });

    const isValid = await verifyAuthorizationHeader({
      header,
      body,
      publicKey: keyPair.publicKey,
      toleranceSeconds: 60,
    });

    assert.equal(isValid, false, 'Expired signature must be rejected');
  });
});

describe('ONDC Light SDK - OndcSellerNode', () => {
  let sellerNode;
  let keyPair;

  before(async () => {
    keyPair = await generateKeyPair();
    sellerNode = new OndcSellerNode({
      subscriberId: 'merchant.ondc.org',
      uniqueKeyId: 'key-1',
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      gatewayUrl: 'https://staging.gateway.ondc.org',
      domain: 'ONDC:RET10',
      city: 'std:080',
    });
  });

  test('should correctly parse valid incoming search request', () => {
    const incomingPayload = {
      context: {
        domain: 'ONDC:RET10',
        country: 'IND',
        city: 'std:080',
        action: 'search',
        core_version: '1.2.0',
        bap_id: 'buyer-app.org',
        bap_uri: 'https://buyer-app.org/ondc',
        transaction_id: 'txn_123456',
        message_id: 'msg_987654',
        timestamp: new Date().toISOString(),
        ttl: 'PT30S',
      },
      message: {
        intent: {
          item: {
            descriptor: {
              name: 'Organic Atta',
            },
          },
        },
      },
    };

    const parsed = sellerNode.parseIncomingRequest(incomingPayload);
    assert.equal(parsed.transactionId, 'txn_123456');
    assert.equal(parsed.messageId, 'msg_987654');
    assert.equal(parsed.bapUri, 'https://buyer-app.org/ondc');
    assert.equal(parsed.bapId, 'buyer-app.org');
    assert.equal(parsed.searchIntent.item.descriptor.name, 'Organic Atta');
  });

  test('should throw error on missing context or required keys', () => {
    assert.throws(
      () => sellerNode.parseIncomingRequest({ message: {} }),
      /Missing mandatory 'context' block/
    );

    assert.throws(
      () =>
        sellerNode.parseIncomingRequest({
          context: { message_id: 'm1', bap_uri: 'http://example.com' },
        }),
      /Missing or invalid 'transaction_id'/
    );

    assert.throws(
      () =>
        sellerNode.parseIncomingRequest({
          context: { transaction_id: 't1', bap_uri: 'http://example.com' },
        }),
      /Missing or invalid 'message_id'/
    );

    assert.throws(
      () =>
        sellerNode.parseIncomingRequest({
          context: { transaction_id: 't1', message_id: 'm1' },
        }),
      /Missing or invalid 'bap_uri'/
    );

    assert.throws(
      () =>
        sellerNode.parseIncomingRequest({
          context: { transaction_id: 't1', message_id: 'm1', bap_uri: 'not-a-valid-url' },
        }),
      /'bap_uri' is not a valid URL/
    );
  });

  test('should map flat items array into standard ONDC catalog structure', () => {
    const flatItems = [
      {
        id: 'SKU-001',
        name: 'Whole Wheat Atta 5kg',
        price: 250,
        currency: 'INR',
        description: 'Healthy flour',
        availableQty: 25,
      },
    ];

    const mapped = sellerNode.mapToCatalogItems(flatItems);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].id, 'SKU-001');
    assert.equal(mapped[0].descriptor.name, 'Whole Wheat Atta 5kg');
    assert.equal(mapped[0].price.value, '250.00');
    assert.equal(mapped[0].price.currency, 'INR');
    assert.equal(mapped[0].quantity.available.count, 25);
  });
});

describe('ONDC Light SDK - Full End-to-End Express Cycle', () => {
  let server;
  const TEST_PORT = 3999;
  let testSellerNode;
  let keyPair;

  before(async () => {
    keyPair = await generateKeyPair();
    testSellerNode = new OndcSellerNode({
      subscriberId: 'seller.e2e.org',
      uniqueKeyId: 'key-1',
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      domain: 'ONDC:RET10',
    });

    const { default: express } = await import('express');
    const app = express();
    app.use(express.json());

    // Mock BAP endpoint to receive on_search
    app.post('/mock-bap/on_search', async (req, res) => {
      const authHeader = req.headers.authorization;
      const isValid = await verifyAuthorizationHeader({
        header: authHeader,
        body: req.body,
        publicKey: keyPair.publicKey,
      });

      res.status(200).json({
        received: true,
        signatureVerified: isValid,
        itemCount: req.body?.message?.catalog?.['bpp/providers']?.[0]?.items?.length || 0,
      });
    });

    // Start server
    await new Promise((resolve) => {
      server = app.listen(TEST_PORT, () => resolve());
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('should dispatch on_search and successfully verify signature at receiver', async () => {
    const result = await testSellerNode.sendOnSearch({
      transactionId: 'txn_e2e_100',
      messageId: 'msg_e2e_200',
      bapUri: `http://localhost:${TEST_PORT}/mock-bap`,
      bapId: 'buyer-app-id',
      items: [
        {
          id: 'ITEM-1',
          name: 'Filter Coffee 250g',
          price: 150,
          description: 'Aromatic coffee',
        },
      ],
      providerName: 'Test Coffee Roasters',
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(result.responseData.received, true);
    assert.equal(result.responseData.signatureVerified, true);
    assert.equal(result.responseData.itemCount, 1);
  });
});
