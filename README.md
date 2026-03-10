# 🌙 Moonlight Accessories — Backend API

Full REST API for the Moonlight Accessories ecommerce website.

## Stack
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL 14+
- **Auth:** JWT (access + refresh tokens)
- **Payment:** JazzCash + Cash on Delivery

---

## Quick Start

### 1. Prerequisites
- Node.js 18+ → https://nodejs.org
- PostgreSQL 14+ → https://postgresql.org
- A PostgreSQL database named `moonlight_db`

### 2. Install
```bash
cd moonlight-backend
npm install
```

### 3. Configure
```bash
cp .env.example .env
# Edit .env with your DB password, JWT secrets, email settings
```

### 4. Setup Database
```bash
# Create tables
npm run db:setup

# Seed products + admin user
npm run db:seed
```

### 5. Run
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server starts at: http://localhost:5000

---

## API Reference

### Base URL
```
http://localhost:5000/api/v1
```

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Register new customer |
| POST | /auth/login | Login |
| POST | /auth/logout | Logout (requires token) |
| POST | /auth/refresh | Refresh access token |
| GET  | /auth/me | Get current user |

**Login Response:**
```json
{
  "success": true,
  "token": "eyJhbGci...",
  "refresh_token": "eyJhbGci...",
  "user": { "id": "uuid", "email": "...", "role": "customer" }
}
```

**Using token:** Add to all protected requests:
```
Authorization: Bearer <token>
```

---

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /products | All products (filter: ?category=straight&sort=price_asc) |
| GET | /products/featured | Featured products |
| GET | /products/shades | All available shades |
| GET | /products/slug/:slug | Single product by slug |
| GET | /products/:id | Single product by ID |
| GET | /products/:id/reviews | Product reviews |
| POST | /products/:id/reviews | Submit review |

**Product Response includes:**
```json
{
  "id": "uuid",
  "name": "Straight 03-Piece",
  "price": "3374.00",
  "variants": [
    { "shade_key": "black", "shade_name": "Natural Black", "in_stock": true, "stock_qty": 50 }
  ],
  "features": ["3-piece clip-in set", "..."],
  "avg_rating": 4.5,
  "review_count": 12
}
```

---

### Cart (requires login)
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | /cart | — | Get cart |
| POST | /cart | `{ variant_id, quantity }` | Add item |
| PUT | /cart/:id | `{ quantity }` | Update quantity |
| DELETE | /cart/:id | — | Remove item |
| DELETE | /cart | — | Clear cart |

---

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /orders | Optional | Place order |
| GET | /orders | Required | My orders |
| GET | /orders/:id | Optional | Order detail |
| PUT | /orders/:id/cancel | Required | Cancel order |

**Place Order Body:**
```json
{
  "shipping_name": "Sana Khan",
  "shipping_phone": "03001234567",
  "shipping_email": "sana@email.com",
  "shipping_address": "House 5, Street 3, DHA",
  "shipping_city": "Lahore",
  "payment_method": "cod",
  "items": [
    { "variant_id": "uuid-of-variant", "quantity": 1 }
  ]
}
```

---

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /payments/cod | Confirm COD order |
| POST | /payments/jazzcash/initiate | Get JazzCash form data |
| POST | /payments/jazzcash/callback | JazzCash posts here after payment |

---

### User (requires login)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /user/profile | Get profile |
| PUT | /user/profile | Update profile |
| PUT | /user/password | Change password |
| GET | /user/orders | Order history |

---

### Admin (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/dashboard | Stats + recent orders + top products |
| GET | /admin/orders | All orders (paginated, filter by status) |
| PUT | /admin/orders/:id/status | Update order status + tracking |
| GET | /admin/products | All products |
| POST | /admin/products | Create product |
| PUT | /admin/products/:id | Update product |
| DELETE | /admin/products/:id | Deactivate product |
| PUT | /admin/variants/:id/stock | Update stock |
| GET | /admin/customers | All customers |
| GET | /admin/reviews | All reviews |
| PUT | /admin/reviews/:id/approve | Approve review |
| DELETE | /admin/reviews/:id | Delete review |

---

## Connecting the Frontend

In your `moonlight-accessories.html`, replace the `addToCart()` function:

```javascript
async function addToCart(pid, shade) {
  const p = PRODUCTS.find(x => x.id === pid);
  const variant = p.variants.find(v => v.shade === shade);

  const res = await fetch('http://localhost:5000/api/v1/cart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('ml_token')}`
    },
    body: JSON.stringify({ variant_id: variant.id, quantity: 1 })
  });

  const data = await res.json();
  if (data.success) showToast(`${p.name} added to cart!`);
}
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| PORT | Server port (default 5000) |
| DB_* | PostgreSQL connection settings |
| JWT_SECRET | Secret for access tokens (min 32 chars) |
| JWT_REFRESH_SECRET | Secret for refresh tokens |
| ADMIN_EMAIL | Admin account email for seeding |
| ADMIN_PASSWORD | Admin account password for seeding |
| SMTP_* | Gmail SMTP for order emails |
| JAZZCASH_* | JazzCash merchant credentials |
| FRONTEND_URL | Your frontend URL (for CORS + redirects) |

---

## Deployment (Production)

1. Set `NODE_ENV=production` in your `.env`
2. Use a process manager: `npm install -g pm2 && pm2 start src/server.js`
3. Use Nginx as a reverse proxy
4. For hosting: Railway, Render, or a VPS (DigitalOcean, Vultr)

---

*Built for Moonlight Accessories · Lahore, Pakistan 🌙*
