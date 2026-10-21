/**
 * ONDC Beckn Protocol TypeScript Definitions
 * Lightweight, strictly typed interfaces representing the foundational ONDC specifications.
 */

export type OndcAction =
  | 'search'
  | 'on_search'
  | 'select'
  | 'on_select'
  | 'init'
  | 'on_init'
  | 'confirm'
  | 'on_confirm'
  | 'status'
  | 'on_status'
  | 'track'
  | 'on_track'
  | 'cancel'
  | 'on_cancel'
  | 'update'
  | 'on_update'
  | 'rating'
  | 'support'
  | 'on_support';

export interface OndcContext {
  domain: string;
  country: string;
  city: string;
  action: OndcAction | string;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl: string;
  key?: string;
}

export interface OndcDescriptor {
  name: string;
  code?: string;
  symbol?: string;
  short_desc?: string;
  long_desc?: string;
  images?: string[];
  audio?: string;
  '3d_render'?: string;
}

export interface OndcTagGroup {
  code: string;
  list: Array<{
    code: string;
    value: string;
  }>;
}

export interface OndcLocation {
  id?: string;
  gps?: string;
  address?: {
    door?: string;
    name?: string;
    building?: string;
    street?: string;
    locality?: string;
    ward?: string;
    city?: string;
    state?: string;
    country?: string;
    area_code?: string;
  };
}

export interface OndcSearchIntent {
  item?: {
    id?: string;
    descriptor?: {
      name?: string;
      code?: string;
      tags?: OndcTagGroup[];
    };
  };
  category?: {
    id?: string;
    descriptor?: {
      name?: string;
      code?: string;
    };
  };
  provider?: {
    id?: string;
    descriptor?: {
      name?: string;
    };
    locations?: Array<{ id: string }>;
  };
  fulfillment?: {
    id?: string;
    type?: string;
    end?: {
      location?: OndcLocation;
    };
  };
  payment?: {
    type?: string;
    collected_by?: string;
  };
  tags?: OndcTagGroup[];
}

export interface OndcSearchMessage {
  intent?: OndcSearchIntent;
}

export interface OndcSearchPayload {
  context: OndcContext;
  message: OndcSearchMessage;
}

export interface OndcPrice {
  currency: string;
  value: string;
  maximum_value?: string;
  minimum_value?: string;
  estimated_value?: string;
  computed_value?: string;
  listed_value?: string;
  offered_value?: string;
}

export interface OndcQuantity {
  allocated?: {
    count: number;
  };
  available?: {
    count: number;
  };
  maximum?: {
    count: number;
  };
  minimum?: {
    count: number;
  };
  selected?: {
    count: number;
  };
  unitized?: {
    measure?: {
      unit: string;
      value: string;
    };
  };
}

export interface OndcCatalogItem {
  id: string;
  parent_item_id?: string;
  descriptor: OndcDescriptor;
  price: OndcPrice;
  category_id?: string;
  fulfillment_id?: string;
  location_id?: string;
  time?: {
    label?: string;
    timestamp?: string;
  };
  matched?: boolean;
  related?: boolean;
  recommended?: boolean;
  quantity?: OndcQuantity;
  tags?: OndcTagGroup[];
  [key: string]: unknown;
}

export interface OndcProvider {
  id: string;
  descriptor: OndcDescriptor;
  categories?: Array<{
    id: string;
    descriptor: OndcDescriptor;
  }>;
  fulfillments?: Array<{
    id: string;
    type: string;
  }>;
  locations?: OndcLocation[];
  items: OndcCatalogItem[];
  tags?: OndcTagGroup[];
}

export interface OndcCatalog {
  'bpp/descriptor'?: OndcDescriptor;
  'bpp/categories'?: Array<{
    id: string;
    descriptor: OndcDescriptor;
  }>;
  'bpp/fulfillments'?: Array<{
    id: string;
    type: string;
  }>;
  'bpp/providers': OndcProvider[];
}

export interface OndcOnSearchMessage {
  catalog: OndcCatalog;
}

export interface OndcOnSearchPayload {
  context: OndcContext;
  message: OndcOnSearchMessage;
}

/**
 * Convenient flat item representation for developers to easily supply products.
 */
export interface OndcItemInput {
  id: string;
  name: string;
  price: number | string;
  currency?: string;
  description?: string;
  longDescription?: string;
  images?: string[];
  categoryId?: string;
  fulfillmentId?: string;
  locationId?: string;
  availableQty?: number;
  tags?: OndcTagGroup[] | Record<string, string>;
  rawItem?: Partial<OndcCatalogItem>;
}

export interface OndcSellerNodeConfig {
  subscriberId: string;
  uniqueKeyId: string;
  privateKey: string;
  publicKey: string;
  gatewayUrl?: string;
  bppId?: string;
  bppUri?: string;
  domain?: string;
  country?: string;
  city?: string;
  ttl?: string;
}

export interface ParsedIncomingRequest {
  transactionId: string;
  messageId: string;
  searchIntent?: OndcSearchIntent;
  bapUri: string;
  bapId: string;
  context: OndcContext;
  raw: unknown;
  isValidSignature?: boolean;
}

export interface SendOnSearchParams {
  transactionId: string;
  messageId: string;
  bapUri: string;
  bapId?: string;
  items: Array<OndcItemInput | OndcCatalogItem>;
  providerId?: string;
  providerName?: string;
  catalogDescriptor?: {
    name: string;
    symbol?: string;
    short_desc?: string;
  };
  customContext?: Partial<OndcContext>;
}

export interface OndcAuthHeaderOptions {
  body: string | object;
  privateKey: string;
  subscriberId: string;
  uniqueKeyId: string;
  ttl?: number;
  created?: number;
}

export interface OndcVerifyHeaderOptions {
  header: string;
  body: string | object;
  publicKey: string;
  toleranceSeconds?: number;
}

export interface OndcSignatureParts {
  subscriberId: string;
  uniqueKeyId: string;
  algorithm: string;
  created: number;
  expires: number;
  headers: string;
  signature: string;
}

export interface OndcValidationErrorDetail {
  loc: Array<string | number>;
  msg: string;
  type: string;
}

export interface OndcValidationResult {
  isValid: boolean;
  status: number;
  statusCode: number;
  detail: OndcValidationErrorDetail[];
}

/**
 * Standard HTTP 422 Unprocessable Entity error representing Beckn payload validation errors.
 * Formatted with "loc", "msg", and "type" fields mimicking FastAPI/Pydantic validation schemas.
 */
export class OndcValidationError extends Error {
  public status = 422;
  public statusCode = 422;
  public detail: OndcValidationErrorDetail[];

  constructor(message: string, detail: OndcValidationErrorDetail[]) {
    super(message);
    this.name = 'OndcValidationError';
    this.detail = detail;
    Object.setPrototypeOf(this, OndcValidationError.prototype);
  }

  public toJSON() {
    return {
      status: this.status,
      statusCode: this.statusCode,
      detail: this.detail,
      message: this.message,
    };
  }
}

