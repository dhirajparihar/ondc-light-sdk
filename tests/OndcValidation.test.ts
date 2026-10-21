/**
 * tests/OndcValidation.test.ts
 * Production-ready automated unit and validation test suite for ondc-light-sdk.
 * Validates Beckn context schema, FastAPI-compliant HTTP 422 error structures,
 * and Ed25519 cryptographic payload integrity.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  OndcSellerNode,
  OndcCrypto,
  generateAuthorizationHeader,
  verifyAuthorizationHeader,
  generateKeyPair,
  OndcValidationError,
  type OndcSearchPayload,
  type OndcValidationResult,
} from '../dist/index.js';

describe('ONDC Validation & Cryptographic Integrity Suite', () => {
  let sellerNode: OndcSellerNode;
  let stagingSigningKeys: {
    publicKey: string;
    privateKey: string;
    keyType: string;
  };

  const STAGING_SUBSCRIBER_ID = 'seller.acmeretail.in';
  const STAGING_UNIQUE_KEY_ID = 'key-2026-v1';

  before(async () => {
    // Generate valid Ed25519 staging keypair
    stagingSigningKeys = await generateKeyPair();

    // Initialize Seller Node instance
    sellerNode = new OndcSellerNode({
      subscriberId: STAGING_SUBSCRIBER_ID,
      uniqueKeyId: STAGING_UNIQUE_KEY_ID,
      privateKey: stagingSigningKeys.privateKey,
      publicKey: stagingSigningKeys.publicKey,
      gatewayUrl: 'https://staging.gateway.ondc.org',
      bppId: STAGING_SUBSCRIBER_ID,
      bppUri: 'https://seller.acmeretail.in/ondc',
      domain: 'ONDC:RET10',
      country: 'IND',
      city: 'std:080',
    });
  });

  // =========================================================================
  // TEST CASE 1: VALID BECKN SEARCH PAYLOAD
  // =========================================================================
  describe('TEST CASE 1: VALID BECKN SEARCH PAYLOAD', () => {
    test('should cleanly extract parameters from a structurally perfect ONDC /search payload', () => {
      // 1. Setup explicit mock Beckn /search payload
      const validSearchPayload: OndcSearchPayload = {
        context: {
          domain: 'ONDC:RET10',
          country: 'IND',
          city: 'std:080',
          action: 'search',
          core_version: '1.2.0',
          bap_id: 'buyer-app.staging.ondc.org',
          bap_uri: 'https://buyer-app.staging.ondc.org/ondc',
          bpp_id: 'seller.acmeretail.in',
          bpp_uri: 'https://seller.acmeretail.in/ondc',
          transaction_id: 'txn_987654321_abc',
          message_id: 'msg_123456789_xyz',
          timestamp: '2026-10-21T14:30:00.000Z',
          ttl: 'PT30S',
        },
        message: {
          intent: {
            item: {
              descriptor: {
                name: 'Aashirvaad Superior MP Atta (5kg)',
                code: 'SKU-ATTA-001',
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

      // 2. Intercept via SDK controller
      const parsed = sellerNode.parseIncomingRequest(
        validSearchPayload as unknown as Record<string, unknown>
      );

      // 3. Assert smooth extraction of all core variables
      assert.equal(
        parsed.transactionId,
        'txn_987654321_abc',
        'Transaction ID must match incoming context exactly'
      );
      assert.equal(
        parsed.messageId,
        'msg_123456789_xyz',
        'Message ID must match incoming context exactly'
      );
      assert.equal(
        parsed.bapUri,
        'https://buyer-app.staging.ondc.org/ondc',
        'BAP URI must match target endpoint'
      );
      assert.equal(
        parsed.bapId,
        'buyer-app.staging.ondc.org',
        'BAP ID must match buyer application domain'
      );
      assert.ok(parsed.searchIntent, 'Search intent must be defined');
      assert.equal(
        parsed.searchIntent?.item?.descriptor?.name,
        'Aashirvaad Superior MP Atta (5kg)',
        'Item query intent must be cleanly extracted'
      );
      assert.equal(
        parsed.context.domain,
        'ONDC:RET10',
        'Retail domain context must be preserved'
      );

      // 4. Assert non-throwing validation method returns HTTP 200 format
      const validationCheck: OndcValidationResult = sellerNode.validateIncomingRequest(
        validSearchPayload as unknown as Record<string, unknown>
      );
      assert.equal(validationCheck.isValid, true);
      assert.equal(validationCheck.status, 200);
      assert.equal(validationCheck.statusCode, 200);
      assert.equal(validationCheck.detail.length, 0);
    });
  });

  // =========================================================================
  // TEST CASE 2: MISSING MANDATORY CONTEXT FIELDS (HTTP 422 & FastAPI "loc"/"msg")
  // =========================================================================
  describe('TEST CASE 2: MISSING MANDATORY CONTEXT FIELDS', () => {
    test('should reject payload with missing transaction_id with HTTP 422 and FastAPI loc/msg structure', () => {
      // 1. Setup malformed payload missing transaction_id
      const payloadMissingTransactionId = {
        context: {
          domain: 'ONDC:RET10',
          country: 'IND',
          city: 'std:080',
          action: 'search',
          core_version: '1.2.0',
          bap_id: 'buyer-app.staging.ondc.org',
          bap_uri: 'https://buyer-app.staging.ondc.org/ondc',
          // transaction_id is missing!
          message_id: 'msg_test_001',
          timestamp: '2026-10-21T14:30:00.000Z',
          ttl: 'PT30S',
        },
        message: {
          intent: {
            item: { descriptor: { name: 'coffee' } },
          },
        },
      };

      // 2. Validate using validateIncomingRequest controller method
      const validationResult = sellerNode.validateIncomingRequest(payloadMissingTransactionId);

      // 3. Assert HTTP 422 status format
      assert.equal(validationResult.isValid, false);
      assert.equal(validationResult.status, 422, 'Must return HTTP 422 Unprocessable Entity status');
      assert.equal(validationResult.statusCode, 422);

      // 4. Assert FastAPI-style "loc" and "msg" fields
      assert.ok(Array.isArray(validationResult.detail), 'Detail must be an array of error locations');
      assert.ok(validationResult.detail.length > 0, 'Detail must contain at least one error');

      const errorEntry = validationResult.detail[0];
      assert.ok(errorEntry.loc, 'Error must contain "loc" field');
      assert.ok(errorEntry.msg, 'Error must contain "msg" field');
      assert.deepEqual(
        errorEntry.loc,
        ['body', 'context', 'transaction_id'],
        'loc field must precisely map path to missing property mimicking FastAPI'
      );
      assert.match(
        errorEntry.msg,
        /transaction_id/i,
        'msg field must describe the missing transaction_id field'
      );

      // 5. Assert parseIncomingRequest throws OndcValidationError with matching 422 payload
      try {
        sellerNode.parseIncomingRequest(payloadMissingTransactionId);
        assert.fail('Should have thrown OndcValidationError');
      } catch (err: unknown) {
        assert.ok(err instanceof OndcValidationError, 'Thrown error must be instance of OndcValidationError');
        assert.equal((err as OndcValidationError).status, 422);
        assert.equal((err as OndcValidationError).statusCode, 422);
        assert.deepEqual(
          (err as OndcValidationError).detail[0].loc,
          ['body', 'context', 'transaction_id']
        );
      }
    });

    test('should reject payload with missing bap_uri with HTTP 422 and FastAPI loc/msg structure', () => {
      // 1. Setup malformed payload missing bap_uri
      const payloadMissingBapUri = {
        context: {
          domain: 'ONDC:RET10',
          country: 'IND',
          city: 'std:080',
          action: 'search',
          core_version: '1.2.0',
          bap_id: 'buyer-app.staging.ondc.org',
          // bap_uri is missing!
          transaction_id: 'txn_test_002',
          message_id: 'msg_test_002',
          timestamp: '2026-10-21T14:30:00.000Z',
          ttl: 'PT30S',
        },
        message: {
          intent: {
            item: { descriptor: { name: 'tea' } },
          },
        },
      };

      const validationResult = sellerNode.validateIncomingRequest(payloadMissingBapUri);

      assert.equal(validationResult.isValid, false);
      assert.equal(validationResult.status, 422);
      assert.deepEqual(
        validationResult.detail[0].loc,
        ['body', 'context', 'bap_uri'],
        'loc field must identify context.bap_uri'
      );
      assert.match(validationResult.detail[0].msg, /bap_uri/i);
    });

    test('should reject payload with completely missing context block with HTTP 422', () => {
      const payloadMissingContext = {
        message: {
          intent: { item: { descriptor: { name: 'rice' } } },
        },
      };

      const validationResult = sellerNode.validateIncomingRequest(payloadMissingContext);

      assert.equal(validationResult.isValid, false);
      assert.equal(validationResult.status, 422);
      assert.deepEqual(validationResult.detail[0].loc, ['body', 'context']);
      assert.match(validationResult.detail[0].msg, /context/i);
    });
  });

  // =========================================================================
  // TEST CASE 3: CRYPTOGRAPHIC SIGNATURE MATCHES & MISMATCHES
  // =========================================================================
  describe('TEST CASE 3: CRYPTOGRAPHIC SIGNATURE MATCHES & MISMATCHES', () => {
    test('should verify valid Ed25519 signature on original body and reject single-character tampered payload', async () => {
      // 1. Construct explicit original request body stream
      const originalPayload = {
        context: {
          domain: 'ONDC:RET10',
          country: 'IND',
          city: 'std:080',
          action: 'search',
          core_version: '1.2.0',
          bap_id: 'buyer-app.staging.ondc.org',
          bap_uri: 'https://buyer-app.staging.ondc.org/ondc',
          transaction_id: 'txn_crypto_verification_777',
          message_id: 'msg_crypto_verification_888',
          timestamp: '2026-10-21T14:45:00.000Z',
          ttl: 'PT30S',
        },
        message: {
          intent: {
            item: {
              descriptor: {
                name: 'Araku Valley Organic Arabica Filter Coffee (250g)',
              },
            },
          },
        },
      };

      const originalBodyString = JSON.stringify(originalPayload);

      // 2. Generate valid ONDC Authorization header signature using official Ed25519 staging keys
      const authorizationHeader = await generateAuthorizationHeader({
        body: originalBodyString,
        privateKey: stagingSigningKeys.privateKey,
        subscriberId: STAGING_SUBSCRIBER_ID,
        uniqueKeyId: STAGING_UNIQUE_KEY_ID,
        ttl: 3600,
      });

      assert.ok(
        authorizationHeader.startsWith('Signature '),
        'Header must begin with Signature keyword'
      );
      assert.match(
        authorizationHeader,
        /algorithm="ed25519"/,
        'Header must specify ed25519 algorithm'
      );

      // 3. Verify that OndcCrypto.verifyAuthorizationHeader() returns true for UNMODIFIED message body
      const isOriginalValid = await verifyAuthorizationHeader({
        header: authorizationHeader,
        body: originalBodyString,
        publicKey: stagingSigningKeys.publicKey,
      });

      assert.equal(
        isOriginalValid,
        true,
        'Valid Ed25519 signature over intact body MUST verify successfully'
      );

      // 4. Intentionally alter a single character in the request body text stream
      // Change "Arabica" to "Brabica" (single byte flip)
      const tamperedBodyString = originalBodyString.replace('Arabica', 'Brabica');

      assert.notEqual(
        tamperedBodyString,
        originalBodyString,
        'Tampered body must differ from original body'
      );
      assert.equal(
        tamperedBodyString.length,
        originalBodyString.length,
        'Tampered body has identical length, only 1 character mutated'
      );

      // 5. Run cryptographic check on tampered body
      const isTamperedValid = await verifyAuthorizationHeader({
        header: authorizationHeader,
        body: tamperedBodyString,
        publicKey: stagingSigningKeys.publicKey,
      });

      // 6. Assert that validation system catches the manipulation and instantly returns failure
      assert.equal(
        isTamperedValid,
        false,
        'Single character alteration MUST immediately fail Blake2b digest and Ed25519 verification'
      );

      // 7. Verify via OndcCrypto namespace object directly as well
      const isNamespaceCheckFailed = await OndcCrypto.verifyAuthorizationHeader({
        header: authorizationHeader,
        body: tamperedBodyString,
        publicKey: stagingSigningKeys.publicKey,
      });

      assert.equal(
        isNamespaceCheckFailed,
        false,
        'OndcCrypto namespace method must also return false on tampered payload'
      );
    });
  });
});
