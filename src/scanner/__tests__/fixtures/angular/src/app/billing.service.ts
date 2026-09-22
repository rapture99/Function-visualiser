const BACKEND_URL = "https://x";
export class BillingService {
  constructor(private http: HttpClient) {}
  pay(id: string) { return this.http.post(BACKEND_URL + `/invoices/${id}/pay`, {}); }
}
