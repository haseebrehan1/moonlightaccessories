const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const authRoutes    = require('./routes/auth.routes');
const productRoutes = require('./routes/product.routes');
const orderRoutes   = require('./routes/order.routes');
const cartRoutes    = require('./routes/cart.routes');
const userRoutes    = require('./routes/user.routes');
const adminRoutes   = require('./routes/admin.routes');
const paymentRoutes  = require('./routes/payment.routes');
const uploadRoutes   = require('./routes/upload.routes');

const app = express();

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'null', // file:// protocol for local HTML
  ],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Global rate limit
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  standardHeaders: true, legacyHeaders: false,
}));

// Strict limit for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// Health check
app.get('/api/health', (req, res) =>
  res.json({ success: true, message: 'Moonlight Accessories API running 🌙', timestamp: new Date().toISOString() })
);

// API docs
app.get('/api/docs', (req, res) => res.json({
  name: 'Moonlight Accessories REST API', version: '1.0.0', base: '/api/v1',
  endpoints: {
    auth:     ['POST /auth/register', 'POST /auth/login', 'POST /auth/logout', 'GET /auth/me', 'POST /auth/refresh'],
    products: ['GET /products', 'GET /products/featured', 'GET /products/shades', 'GET /products/slug/:slug', 'GET /products/:id'],
    cart:     ['GET /cart', 'POST /cart', 'PUT /cart/:id', 'DELETE /cart/:id', 'DELETE /cart'],
    orders:   ['POST /orders', 'GET /orders', 'GET /orders/:id', 'PUT /orders/:id/cancel'],
    payments: ['POST /payments/jazzcash/initiate', 'POST /payments/jazzcash/callback', 'POST /payments/cod'],
    user:     ['GET /user/profile', 'PUT /user/profile', 'PUT /user/password', 'GET /user/orders'],
    admin:    ['GET /admin/dashboard', 'GET /admin/orders', 'PUT /admin/orders/:id/status',
               'GET /admin/products', 'POST /admin/products', 'PUT /admin/products/:id',
               'GET /admin/customers', 'GET /admin/reviews', 'PUT /admin/reviews/:id/approve'],
  },
}));

// Routes
app.use('/api/v1/auth',     authLimiter, authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart',     cartRoutes);
app.use('/api/v1/orders',   orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/user',     userRoutes);
app.use('/api/v1/admin',    adminRoutes);
app.use('/api/v1/upload',   uploadRoutes);

// 404
app.use('*', (req, res) => res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  const code = err.statusCode || err.status || 500;
  res.status(code).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
