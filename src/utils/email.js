const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

exports.sendOrderConfirmation = async (toEmail, order, items) => {
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.product_name} — ${i.shade_name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">Rs. ${parseFloat(i.line_total).toLocaleString()}</td>
    </tr>
  `).join('');

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Moonlight Accessories <orders@moonlightaccessories.pk>',
    to: toEmail,
    subject: `Order Confirmed — ${order.order_number} 🌙`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1108">
        <div style="background:#1a1108;padding:24px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">🌙 Moonlight Accessories</h1>
          <p style="color:#b8914a;margin:6px 0 0;font-size:12px;letter-spacing:3px">PREMIUM HAIR EXTENSIONS</p>
        </div>
        <div style="padding:32px">
          <h2 style="color:#C8102E">Order Confirmed!</h2>
          <p>Hi ${order.shipping_name}, your order <strong>${order.order_number}</strong> has been received.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <thead><tr style="background:#f5f0eb">
              <th style="padding:10px;text-align:left">Product</th>
              <th style="padding:10px;text-align:center">Qty</th>
              <th style="padding:10px;text-align:right">Total</th>
            </tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <table style="width:100%;max-width:300px;margin-left:auto">
            <tr><td>Subtotal</td><td style="text-align:right">Rs. ${parseFloat(order.subtotal).toLocaleString()}</td></tr>
            <tr><td>Shipping</td><td style="text-align:right">${parseFloat(order.shipping_fee)===0?'Free':'Rs. '+parseFloat(order.shipping_fee).toLocaleString()}</td></tr>
            <tr style="font-weight:bold;font-size:16px"><td>Total</td><td style="text-align:right;color:#C8102E">Rs. ${parseFloat(order.total).toLocaleString()}</td></tr>
          </table>
          <div style="background:#f5f0eb;padding:16px;margin-top:24px;border-left:3px solid #C8102E">
            <strong>Delivery Address:</strong><br>
            ${order.shipping_name}<br>${order.shipping_address}, ${order.shipping_city}<br>${order.shipping_phone}
          </div>
          <p style="color:#7a6a58;font-size:12px;margin-top:24px">
            Payment: <strong>${order.payment_method.toUpperCase()}</strong><br>
            Questions? WhatsApp us or visit instagram.com/moonlightaccessories.pk
          </p>
        </div>
        <div style="background:#f5f0eb;padding:16px;text-align:center;font-size:11px;color:#7a6a58">
          © ${new Date().getFullYear()} Moonlight Accessories · Lahore, Pakistan
        </div>
      </div>
    `,
  });
};
