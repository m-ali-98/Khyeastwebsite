/* Customer-facing order projection. Keep this explicit allowlist shared by the
 * authenticated account API and tracking views so internal order/payment fields
 * never leak when the database row grows. */
export function publicOrderView(order = {}) {
  return {
    code: order.code,
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
          slug: item?.slug,
          title: item?.title,
          unit: item?.unit,
          price: item?.price,
          qty: item?.qty,
          sum: item?.sum,
        }))
      : [],
    customer: {
      name: order.customer?.name,
      phone: order.customer?.phone,
      city: order.customer?.city,
      address: order.customer?.address,
      postal: order.customer?.postal,
      note: order.customer?.note,
    },
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    currency: order.currency,
    status: order.status,
    at: order.at,
  };
}
