export interface Transaction {
  id: string;
  amount: number;
  memo?: string;
  createdAt: number;
}
