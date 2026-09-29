'use strict';
/**
 * Wheatburn shop — central configuration.
 *
 * Every tunable in the shop lives here so that nothing business-critical is
 * buried in the middle of a route handler. Values can be overridden with
 * environment variables (see README).
 */

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: path.join(ROOT, 'data'),
  DB_FILE: process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'),
  OUTBOX_FILE: process.env.OUTBOX_FILE || path.join(ROOT, 'data', 'outbox.log'),

  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV,
  isProduction,

  /**
   * Public storefront facts. Everything marked PLACEHOLDER must be replaced
   * with the real value before the site goes live — see SITE-TODO in the
   * marketing site folder.
   */
  brand: {
    name: 'Wheatburn',
    tagline: 'Baked in Kigali every morning',
    sub: 'Kigali · Rwanda',
    promise: 'Cassava, sorghum, millet, honey, groundnut and local fruit — named in Kinyarwanda.',
    phone: process.env.STORE_PHONE || '+250 788 000 000', // PLACEHOLDER
    whatsapp: process.env.STORE_WHATSAPP || '250788000000', // PLACEHOLDER, digits only (wa.me)
    email: process.env.STORE_EMAIL || 'orders@wheatburn.rw', // PLACEHOLDER
    address: process.env.STORE_ADDRESS || 'KG 11 Ave, Kicukiro, Kigali, Rwanda', // PLACEHOLDER
    hours: 'Mon–Sat, 07:00–18:00',
    closedDays: 'Sunday',
    // Social links — replace the '#' placeholders with real profiles.
    social: {
      instagram: '#',
      facebook: '#',
      tiktok: '#'
    }
  },

  /** Authentication and one-time-code policy. */
  security: {
    sessionCookie: 'wb_session',
    challengeCookie: 'wb_challenge',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days

    otpLength: 6,
    otpTtlMs: 5 * 60 * 1000, // requirement 13: OTP expires quickly
    otpMaxAttempts: 5,
    otpResendCooldownMs: 60 * 1000,
    otpWindowMs: 15 * 60 * 1000,
    otpMaxPerWindow: 3,

    resetTtlMs: 15 * 60 * 1000,
    loginMaxAttempts: 10,
    loginWindowMs: 15 * 60 * 1000,

    minPasswordLength: 8,
    // Secret used to hash one-time codes at rest. Must be set in production.
    otpPepper: process.env.OTP_PEPPER || 'dev-otp-pepper-change-me'
  },

  /** Ordering rules. */
  order: {
    prefix: 'WB',
    minOrderRwf: Number(process.env.MIN_ORDER_RWF || 2000),
    freeDeliveryFromRwf: Number(process.env.FREE_DELIVERY_FROM_RWF || 20000),
    /** Orders placed after this hour join the next dawn bake. */
    sameDayCutoffHour: 16,
    staffToken: process.env.STAFF_TOKEN || 'dev-staff-token'
  },

  /** SMS / WhatsApp delivery. Without provider credentials, messages are logged. */
  notify: {
    providerUrl: process.env.SMS_PROVIDER_URL || '',
    providerToken: process.env.SMS_PROVIDER_TOKEN || '',
    senderId: process.env.SMS_SENDER_ID || 'WHEATBURN'
  }
};
