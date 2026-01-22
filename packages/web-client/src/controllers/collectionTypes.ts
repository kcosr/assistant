export type CollectionReference = {
  type: string;
  id: string;
  instanceId?: string;
};

export type CollectionItemSummary = {
  type: string;
  id: string;
  name: string;
  tags?: string[];
  updatedAt?: string;
  instanceId?: string;
  instanceLabel?: string;
};
