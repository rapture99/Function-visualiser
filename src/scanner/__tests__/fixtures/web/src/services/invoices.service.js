import axios from "axios";
export const listInvoices = () => axios.get("/invoices");
export const payInvoice = (id) => axios.put(`/invoices/${id}/pay`);
export const fetchOne = (url) => axios.get(url);
