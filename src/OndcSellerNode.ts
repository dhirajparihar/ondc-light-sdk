/**
 * OndcSellerNode.ts
 * Core Seller Node class managing ONDC network interactions, request parsing,
 * context syntax validation, signature checking, and catalog dispatching.
 */

import axios, { type AxiosResponse } from 'axios';
import {
  generateAuthorizationHeader,
  parseAuthorizationHeader,
  verifyAuthorizationHeaderSync,
} from './OndcCrypto.js';
import {
  type OndcContext,
  type OndcSellerNodeConfig,
  type ParsedIncomingRequest,
  type SendOnSearchParams,
  type OndcItemInput,
  type OndcCatalogItem,
  type OndcOnSearchPayload,
  type OndcSearchIntent,
  type OndcValidationResult,
  OndcValidationError,
} from './types.js';

export class OndcSellerNode {
  public subscriberId: string;
  public uniqueKeyId: string;
  public privateKey: string;
  public publicKey: string;
  public gatewayUrl: string;
  public bppId: string;
  public bppUri: string;
  public domain: string;
  public country: string;
  public city: string;
  public ttl: string;

  /**
   * Initializes the OndcSellerNode.
   * Can be instantiated using a configuration object or positional arguments.
   */
  constructor(
    configOrSubscriberId: OndcSellerNodeConfig | string,
    uniqueKeyId?: string,
    privateKey?: string,
    publicKey?: string,
    gatewayUrl?: string,
    options?: Partial<OndcSellerNodeConfig>
  ) {
    if (typeof configOrSubscriberId === 'object' && configOrSubscriberId !== null) {
      const cfg = configOrSubscriberId;
      this.subscriberId = cfg.subscriberId;
      this.uniqueKeyId = cfg.uniqueKeyId;
      this.privateKey = cfg.privateKey;
      this.publicKey = cfg.publicKey;
      this.gatewayUrl = cfg.gatewayUrl || 'https://staging.gateway.ondc.org';
      this.bppId = cfg.bppId || cfg.subscriberId;
      this.bppUri = cfg.bppUri || 'http://localhost:3000/ondc';
      this.domain = cfg.domain || 'ONDC:RET10';
      this.country = cfg.country || 'IND';
      this.city = cfg.city || 'std:080';
      this.ttl = cfg.ttl || 'PT30S';
    } else {
      this.subscriberId = configOrSubscriberId;
      this.uniqueKeyId = uniqueKeyId || 'key-1';
      this.privateKey = privateKey || '';
      this.publicKey = publicKey || '';
      this.gatewayUrl = gatewayUrl || 'https://staging.gateway.ondc.org';
      this.bppId = options?.bppId || this.subscriberId;
      this.bppUri = options?.bppUri || 'http://localhost:3000/ondc';
      this.domain = options?.domain || 'ONDC:RET10';
      this.country = options?.country || 'IND';
      this.city = options?.city || 'std:080';
      this.ttl = options?.ttl || 'PT30S';
    }

    if (!this.subscriberId) {
      throw new Error('OndcSellerNode requires a valid subscriberId.');
    }
  }

  /**
   * Validates an incoming request payload structure without throwing,
   * returning an HTTP 422 status format with 'loc' and 'msg' fields mimicking FastAPI.
   */
  public validateIncomingRequest(
    reqOrBody: Record<string, unknown>
  ): OndcValidationResult {
    try {
      this.parseIncomingRequest(reqOrBody);
      return {
        isValid: true,
        status: 200,
        statusCode: 200,
        detail: [],
      };
    } catch (err: unknown) {
      if (err instanceof OndcValidationError) {
        return {
          isValid: false,
          status: err.status,
          statusCode: err.statusCode,
          detail: err.detail,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        isValid: false,
        status: 422,
        statusCode: 422,
        detail: [
          {
            loc: ['body'],
            msg: message,
            type: 'value_error',
          },
        ],
      };
    }
  }

  /**
   * Synchronous controller method that intercepts an incoming gateway web request bundle,
   * securely validates its contextual syntax, checks headers using OndcCrypto, and
   * extracts clean variables: transactionId, messageId, searchIntent, and bapUri.
   *
   * @param reqOrBody An Express request object (containing body & headers) or the raw JSON request body
   * @param reqHeaders Optional request headers map if only the body was passed
   * @param buyerPublicKey Optional buyer public key for cryptographically verifying the signature
   */
  public parseIncomingRequest(
    reqOrBody: Record<string, unknown>,
    reqHeaders?: Record<string, string | string[] | undefined>,
    buyerPublicKey?: string
  ): ParsedIncomingRequest {
    if (!reqOrBody || typeof reqOrBody !== 'object') {
      throw new OndcValidationError('Incoming request body must be a valid non-null object.', [
        {
          loc: ['body'],
          msg: 'Incoming request body must be a valid non-null object.',
          type: 'value_error.missing',
        },
      ]);
    }

    // Support both raw body and Express `req` objects
    let body: Record<string, unknown> = reqOrBody;
    let headers: Record<string, string | string[] | undefined> = reqHeaders || {};

    if (
      'body' in reqOrBody &&
      reqOrBody.body &&
      typeof reqOrBody.body === 'object' &&
      ('headers' in reqOrBody || 'header' in reqOrBody)
    ) {
      body = reqOrBody.body as Record<string, unknown>;
      headers = (reqOrBody.headers || {}) as Record<string, string | string[] | undefined>;
    }

    // 1. Contextual Syntax Validation
    const context = body.context as OndcContext | undefined;
    if (!context || typeof context !== 'object') {
      throw new OndcValidationError("Invalid ONDC payload: Missing mandatory 'context' block.", [
        {
          loc: ['body', 'context'],
          msg: "Missing mandatory 'context' block.",
          type: 'value_error.missing',
        },
      ]);
    }

    if (!context.transaction_id || typeof context.transaction_id !== 'string') {
      throw new OndcValidationError("Invalid ONDC context: Missing or invalid 'transaction_id'.", [
        {
          loc: ['body', 'context', 'transaction_id'],
          msg: "Field required: Missing or invalid 'transaction_id'.",
          type: 'value_error.missing',
        },
      ]);
    }

    if (!context.message_id || typeof context.message_id !== 'string') {
      throw new OndcValidationError("Invalid ONDC context: Missing or invalid 'message_id'.", [
        {
          loc: ['body', 'context', 'message_id'],
          msg: "Field required: Missing or invalid 'message_id'.",
          type: 'value_error.missing',
        },
      ]);
    }

    if (!context.bap_uri || typeof context.bap_uri !== 'string') {
      throw new OndcValidationError("Invalid ONDC context: Missing or invalid 'bap_uri'.", [
        {
          loc: ['body', 'context', 'bap_uri'],
          msg: "Field required: Missing or invalid 'bap_uri'.",
          type: 'value_error.missing',
        },
      ]);
    }

    try {
      new URL(context.bap_uri);
    } catch {
      throw new OndcValidationError(
        `Invalid ONDC context: 'bap_uri' is not a valid URL: "${context.bap_uri}"`,
        [
          {
            loc: ['body', 'context', 'bap_uri'],
            msg: `'bap_uri' is not a valid URL: "${context.bap_uri}"`,
            type: 'value_error.url',
          },
        ]
      );
    }

    // 2. Extract Authorization Header and Check Signature
    let isValidSignature: boolean | undefined = undefined;
    const authHeaderRaw =
      headers.authorization ||
      headers.Authorization ||
      headers['x-gateway-authorization'] ||
      headers['X-Gateway-Authorization'];

    const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;

    if (authHeader && typeof authHeader === 'string') {
      try {
        // Validate structural layout of the Authorization header
        const parts = parseAuthorizationHeader(authHeader);
        if (parts.algorithm !== 'ed25519') {
          isValidSignature = false;
        } else if (buyerPublicKey) {
          // Cryptographically verify using buyer's Ed25519 public key
          isValidSignature = verifyAuthorizationHeaderSync({
            header: authHeader,
            body,
            publicKey: buyerPublicKey,
          });
        } else {
          // Check expiration timestamp without public key
          const now = Math.floor(Date.now() / 1000);
          isValidSignature = parts.expires ? parts.expires + 300 >= now : true;
        }
      } catch {
        isValidSignature = false;
      }
    }

    // 3. Extract Clean Variables
    const message = (body.message || {}) as { intent?: OndcSearchIntent };
    const searchIntent = message.intent;

    return {
      transactionId: context.transaction_id,
      messageId: context.message_id,
      searchIntent,
      bapUri: context.bap_uri,
      bapId: context.bap_id || '',
      context,
      raw: body,
      isValidSignature,
    };
  }

  /**
   * Helper method to map simple flat product objects or full Beckn items
   * into standardized ONDC catalog items.
   */
  public mapToCatalogItems(
    items: Array<OndcItemInput | OndcCatalogItem>
  ): OndcCatalogItem[] {
    return items.map((item, idx) => {
      // If it's already a full Beckn catalog item with descriptor & price objects
      if ('descriptor' in item && 'price' in item && typeof item.price === 'object') {
        return item as OndcCatalogItem;
      }

      // Convert flat OndcItemInput
      const flat = item as OndcItemInput;
      const priceVal =
        typeof flat.price === 'number'
          ? flat.price.toFixed(2)
          : String(flat.price || '0.00');

      const catalogItem: OndcCatalogItem = {
        id: String(flat.id || `item_${idx + 1}`),
        descriptor: {
          name: flat.name || `Product ${idx + 1}`,
          code: flat.id || `CODE_${idx + 1}`,
          symbol: flat.images?.[0] || '',
          short_desc: flat.description || flat.name || '',
          long_desc: flat.longDescription || flat.description || flat.name || '',
          images: flat.images || [],
        },
        price: {
          currency: flat.currency || 'INR',
          value: priceVal,
          maximum_value: priceVal,
        },
        category_id: flat.categoryId || 'General',
        fulfillment_id: flat.fulfillmentId || 'F1',
        location_id: flat.locationId || 'L1',
        quantity: {
          available: {
            count: flat.availableQty !== undefined ? flat.availableQty : 99,
          },
          maximum: {
            count: flat.availableQty !== undefined ? flat.availableQty : 99,
          },
        },
        ...(flat.rawItem || {}),
      };

      return catalogItem;
    });
  }

  /**
   * Asynchronous pipeline method that builds a legally compliant ONDC on_search
   * JSON response package. It maps local products into the nested structural syntax
   * required by ONDC (message.catalog.bpp/providers.items), signs the payload,
   * and fires an outbound Axios POST request directly to the network's bapUri/on_search node.
   */
  public async sendOnSearch(params: SendOnSearchParams): Promise<{
    success: boolean;
    targetUrl: string;
    payload: OndcOnSearchPayload;
    status: number;
    responseData: unknown;
  }> {
    const {
      transactionId,
      messageId,
      bapUri,
      bapId,
      items,
      providerId = 'P1',
      providerName = 'ONDC Local Merchant',
      catalogDescriptor,
      customContext = {},
    } = params;

    if (!transactionId || !messageId || !bapUri) {
      throw new Error('transactionId, messageId, and bapUri are mandatory to dispatch on_search.');
    }

    // 1. Map local items into Beckn catalog items
    const catalogItems = this.mapToCatalogItems(items || []);

    // 2. Build compliant Beckn context
    const timestamp = new Date().toISOString();
    const context: OndcContext = {
      domain: this.domain,
      country: this.country,
      city: this.city,
      action: 'on_search',
      core_version: '1.2.0',
      bap_id: bapId || '',
      bap_uri: bapUri,
      bpp_id: this.bppId || this.subscriberId,
      bpp_uri: this.bppUri,
      transaction_id: transactionId,
      message_id: messageId,
      timestamp,
      ttl: this.ttl,
      ...customContext,
    };

    // 3. Assemble nested Beckn catalog payload
    const onSearchPayload: OndcOnSearchPayload = {
      context,
      message: {
        catalog: {
          'bpp/descriptor': {
            name: catalogDescriptor?.name || providerName,
            symbol: catalogDescriptor?.symbol || '',
            short_desc: catalogDescriptor?.short_desc || `${providerName} Direct Store Catalog`,
          },
          'bpp/providers': [
            {
              id: providerId,
              descriptor: {
                name: providerName,
                short_desc: `${providerName} Storefront`,
              },
              items: catalogItems,
            },
          ],
        },
      },
    };

    // 4. Generate HTTP Authorization header signature
    const authHeader = await generateAuthorizationHeader({
      body: onSearchPayload,
      privateKey: this.privateKey,
      subscriberId: this.subscriberId,
      uniqueKeyId: this.uniqueKeyId,
    });

    // 5. Construct target Beckn endpoint URL
    const targetUrl = `${bapUri.replace(/\/+$/, '')}/on_search`;

    // 6. Fire live outbound Axios POST request
    try {
      const response: AxiosResponse = await axios.post(targetUrl, onSearchPayload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        timeout: 10000,
      });

      return {
        success: true,
        targetUrl,
        payload: onSearchPayload,
        status: response.status,
        responseData: response.data,
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const errorMsg = `ONDC on_search dispatch failed to ${targetUrl}: ${error.message} (status: ${error.response?.status || 'network error'})`;
        throw new Error(errorMsg);
      }
      throw error;
    }
  }
}

export default OndcSellerNode;
