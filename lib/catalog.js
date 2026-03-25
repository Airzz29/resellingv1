/**
 * Single source of truth for storefront products (ids used in URLs, admin, and storage).
 */
const PRODUCTS = [
  {
    id: 'guide-to-reselling',
    name: 'Guide to Reselling',
    price: 20,
    category: 'Guides',
    size: 'big',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
  {
    id: 'jordan-4-supplier',
    name: 'Jordan 4 Supplier',
    price: 20,
    category: 'Footwear',
    size: 'normal',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
  {
    id: 'dyson-supplier',
    name: 'Dyson Supplier',
    price: 20,
    category: 'Electronics',
    size: 'normal',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
  {
    id: 'cologne-vendor',
    name: 'Cologne Vendor',
    price: 20,
    category: 'Fragrance',
    size: 'normal',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
  {
    id: 'polo-supplier',
    name: 'Polo Supplier',
    price: 20,
    category: 'Fashion',
    size: 'normal',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
  {
    id: 'all-item-suppliers',
    name: 'All Item Suppliers',
    price: 20,
    category: 'Bundles',
    size: 'normal',
    desc: 'Exclusive line sheet and contact flow. Request delivery to your inbox.',
  },
];

function getById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

function isValidId(id) {
  return PRODUCTS.some((p) => p.id === id);
}

module.exports = { PRODUCTS, getById, isValidId };
