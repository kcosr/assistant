export type ListCustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'checkbox';

export interface ListCustomFieldDefinition {
  key: string;
  label: string;
  type: ListCustomFieldType;
  options?: string[];
}
