export type ListCustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'ref';

export interface ListCustomFieldDefinition {
  key: string;
  label: string;
  type: ListCustomFieldType;
  options?: string[];
  markdown?: boolean;
}
