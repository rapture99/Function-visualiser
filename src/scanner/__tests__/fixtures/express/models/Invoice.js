const mongoose = require("mongoose");
const InvoiceSchema = new mongoose.Schema({ total: Number });
module.exports = mongoose.model("Invoice", InvoiceSchema);
