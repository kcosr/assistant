import { z } from 'zod';

export const PanelBindingSchema = z.union([
  z.object({ mode: z.literal('fixed'), sessionId: z.string().min(1) }),
  z.object({ mode: z.literal('global') }),
]);

export type PanelBinding = z.infer<typeof PanelBindingSchema>;

export const PanelStatusSchema = z.enum(['idle', 'busy', 'error']);
export type PanelStatus = z.infer<typeof PanelStatusSchema>;

export const PanelMetadataSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  badge: z.string().optional(),
  status: PanelStatusSchema.optional(),
});

export type PanelMetadata = z.infer<typeof PanelMetadataSchema>;

export const PanelInventoryItemSchema = z.object({
  panelId: z.string().min(1),
  panelType: z.string().min(1),
  panelTitle: z.string().min(1).optional(),
  visible: z.boolean(),
  binding: PanelBindingSchema.nullable().optional(),
  context: z.record(z.unknown()).nullable().optional(),
});

export type PanelInventoryItem = z.infer<typeof PanelInventoryItemSchema>;

export const PanelInventoryPayloadSchema = z.object({
  type: z.literal('panel_inventory'),
  panels: z.array(PanelInventoryItemSchema),
  selectedPanelId: z.string().min(1).nullable(),
  selectedChatPanelId: z.string().min(1).nullable(),
  layout: z.lazy(() => LayoutNodeSchema).optional(),
  headerPanels: z.array(z.string().min(1)).optional(),
  windowId: z.string().min(1).optional(),
});

export type PanelInventoryPayload = z.infer<typeof PanelInventoryPayloadSchema>;

export interface PanelInstance {
  panelId: string;
  panelType: string;
  binding?: PanelBinding;
  state?: unknown;
  meta?: PanelMetadata;
}

const PanelInstanceSchemaBase = z.object({
  panelId: z.string().min(1),
  panelType: z.string().min(1),
  binding: PanelBindingSchema.optional(),
  state: z.unknown().optional(),
  meta: PanelMetadataSchema.optional(),
});

type PanelInstanceInput = z.input<typeof PanelInstanceSchemaBase>;

export const PanelInstanceSchema: z.ZodType<PanelInstance, z.ZodTypeDef, PanelInstanceInput> = z
  .object(PanelInstanceSchemaBase.shape)
  .transform((value) => {
    const instance: PanelInstance = {
      panelId: value.panelId,
      panelType: value.panelType,
    };
    if (value.binding) {
      instance.binding = value.binding;
    }
    if (value.state !== undefined) {
      instance.state = value.state;
    }
    if (value.meta) {
      instance.meta = value.meta;
    }
    return instance;
  });

export type LayoutNode =
  | {
      kind: 'split';
      splitId: string;
      direction: 'horizontal' | 'vertical';
      sizes: number[];
      children: LayoutNode[];
      viewMode?: 'split' | 'tabs';
      activeId?: string;
    }
  | {
      kind: 'panel';
      panelId: string;
    };

type SplitLayoutNode = Extract<LayoutNode, { kind: 'split' }>;
type PanelLayoutNode = Extract<LayoutNode, { kind: 'panel' }>;

export const LayoutNodeSchema: z.ZodType<LayoutNode, z.ZodTypeDef, unknown> = z.lazy(() => {
  const splitSchemaBase = z.object({
    kind: z.literal('split'),
    splitId: z.string().min(1),
    direction: z.enum(['horizontal', 'vertical']),
    sizes: z.array(z.number().positive()).min(2),
    children: z.array(LayoutNodeSchema).min(2),
    viewMode: z.enum(['split', 'tabs']).optional(),
    activeId: z.string().min(1).optional(),
  });

  type SplitLayoutNodeInput = z.input<typeof splitSchemaBase>;
  const splitSchema: z.ZodType<SplitLayoutNode, z.ZodTypeDef, SplitLayoutNodeInput> =
    splitSchemaBase
      .superRefine((value, ctx) => {
        if (value.sizes.length !== value.children.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Split sizes must match number of children.',
            path: ['sizes'],
          });
        }
      })
      .transform((value) => {
        const { viewMode, activeId, ...rest } = value;
        const node: SplitLayoutNode = {
          ...rest,
          ...(viewMode ? { viewMode } : {}),
          ...(activeId ? { activeId } : {}),
        };
        return node;
      });

  const panelSchema: z.ZodType<PanelLayoutNode> = z.object({
    kind: z.literal('panel'),
    panelId: z.string().min(1),
  });

  return z.union([splitSchema, panelSchema]);
});

export interface LayoutPersistence {
  layout: LayoutNode;
  panels: Record<string, PanelInstance>;
  headerPanels: string[];
  headerPanelSizes: Record<string, { width: number; height: number }>;
}

const HeaderPanelSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const _LayoutPersistenceSchemaBase = z.object({
  layout: LayoutNodeSchema,
  panels: z.record(PanelInstanceSchemaBase),
  headerPanels: z.array(z.string().min(1)).default([]),
  headerPanelSizes: z.record(HeaderPanelSizeSchema).default({}),
});

type LayoutPersistenceInput = z.input<typeof _LayoutPersistenceSchemaBase>;

export const LayoutPersistenceSchema: z.ZodType<
  LayoutPersistence,
  z.ZodTypeDef,
  LayoutPersistenceInput
> = z.object({
  layout: LayoutNodeSchema,
  panels: z.record(PanelInstanceSchema),
  headerPanels: z.array(z.string().min(1)).default([]),
  headerPanelSizes: z.record(HeaderPanelSizeSchema).default({}),
});

export const PanelSizeSchema = z.object({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export type PanelSize = z.infer<typeof PanelSizeSchema>;

export const PanelPlacementSchema = z.object({
  region: z.enum(['left', 'right', 'top', 'bottom', 'center']),
  size: PanelSizeSchema.optional(),
});

export type PanelPlacement = z.infer<typeof PanelPlacementSchema>;

export const PanelTypeManifestSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  multiInstance: z.boolean().optional(),
  defaultSessionBinding: z.enum(['fixed', 'global']).optional(),
  sessionScope: z.enum(['required', 'optional', 'global']).optional(),
  defaultPlacement: PanelPlacementSchema.optional(),
  defaultPinned: z.boolean().optional(),
  minSize: PanelSizeSchema.optional(),
  maxSize: PanelSizeSchema.optional(),
  capabilities: z.array(z.string()).optional(),
});

export type PanelTypeManifest = z.infer<typeof PanelTypeManifestSchema>;

export const ServerPluginManifestSchema = z.object({
  provides: z.array(z.string()),
  capabilities: z.array(z.string()).optional(),
  requiresCore: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  dataDir: z.string().optional(),
  settingsSchema: z.unknown().optional(),
  migrations: z.array(z.unknown()).optional(),
});

export type ServerPluginManifest = z.infer<typeof ServerPluginManifestSchema>;

export type PluginJsonSchemaTypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export type PluginJsonSchema = {
  type?: PluginJsonSchemaTypeName | PluginJsonSchemaTypeName[];
  description?: string;
  properties?: Record<string, PluginJsonSchema>;
  items?: PluginJsonSchema | PluginJsonSchema[];
  required?: string[];
  enum?: unknown[];
};

export type PluginJsonSchemaObject = PluginJsonSchema & {
  type: 'object';
  properties: Record<string, PluginJsonSchema>;
  required?: string[];
};

const PluginJsonSchemaBaseSchema = z
  .object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    description: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
    items: z.unknown().optional(),
    required: z.array(z.string()).optional(),
    enum: z.array(z.unknown()).optional(),
  })
  .passthrough();

const PluginJsonSchemaObjectSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

export const PluginOperationToolSchema = z.object({
  description: z.string().min(1).optional(),
});

export type PluginOperationTool = z.infer<typeof PluginOperationToolSchema>;

export const PluginOperationSurfacesSchema = z.object({
  tool: z.boolean().optional(),
  http: z.boolean().optional(),
  cli: z.boolean().optional(),
});

export type PluginOperationSurfaces = z.infer<typeof PluginOperationSurfacesSchema>;

export const PluginOperationHttpSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  path: z.string().min(1).optional(),
  query: z.array(z.string().min(1)).optional(),
  body: z.boolean().optional(),
  successStatus: z.number().int().positive().optional(),
});

export type PluginOperationHttp = z.infer<typeof PluginOperationHttpSchema>;

export const PluginOperationCliOptionSchema = z.object({
  name: z.string().min(1),
  flag: z.string().min(1).optional(),
  alias: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'json']).optional(),
  array: z.boolean().optional(),
  required: z.boolean().optional(),
});

export type PluginOperationCliOption = z.infer<typeof PluginOperationCliOptionSchema>;

export const PluginOperationCliSchema = z.object({
  command: z.string().min(1).optional(),
  description: z.string().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  options: z.array(PluginOperationCliOptionSchema).optional(),
});

export type PluginOperationCli = z.infer<typeof PluginOperationCliSchema>;

export const PluginOperationSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  inputSchema: PluginJsonSchemaObjectSchema,
  outputSchema: PluginJsonSchemaBaseSchema.optional(),
  capabilities: z.array(z.string()).optional(),
  tool: PluginOperationToolSchema.optional(),
  http: PluginOperationHttpSchema.optional(),
  cli: PluginOperationCliSchema.optional(),
});

export type PluginOperation = z.infer<typeof PluginOperationSchema>;

export const PluginSkillsSchema = z.object({
  autoExport: z.boolean().optional(),
});

export type PluginSkills = z.infer<typeof PluginSkillsSchema>;

export const CombinedPluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1).optional(),
  panels: z.array(PanelTypeManifestSchema).optional(),
  web: z
    .object({
      bundlePath: z.string().min(1).optional(),
      stylesPath: z.string().min(1).optional(),
    })
    .optional(),
  server: ServerPluginManifestSchema.optional(),
  capabilities: z.array(z.string()).optional(),
  settingsSchema: z.unknown().optional(),
  surfaces: PluginOperationSurfacesSchema.optional(),
  skills: PluginSkillsSchema.optional(),
  operations: z.array(PluginOperationSchema).optional(),
});

export type CombinedPluginManifest = z.infer<typeof CombinedPluginManifestSchema>;

export const PanelEventEnvelopeSchema = z.object({
  type: z.literal('panel_event'),
  panelId: z.string().min(1),
  panelType: z.string().min(1),
  sessionId: z.string().optional(),
  windowId: z.string().min(1).optional(),
  payload: z.unknown(),
});

export type PanelEventEnvelope = z.infer<typeof PanelEventEnvelopeSchema>;
