const router = require('express').Router();
const controller = require('../controllers/invoices.controller');
router.get("/invoices", controller.list);
router.post("/invoices", controller.create);
router.put("/invoices/:id/pay", controller.pay);
module.exports = router;
