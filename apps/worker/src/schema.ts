import { glyphMetadataSchema } from '@pentwin/engine';
import { z } from 'zod';

/** Longest single string accepted anywhere in a request. */
const MAX_TEXT = 20_000;
const text = z.string().max(MAX_TEXT);

const run = z.object({
  text,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
const content = z.union([text, z.array(run).max(500)]);

const block = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text,
    level: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
  z.object({ type: z.literal('paragraph'), text: content }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean().optional(),
    items: z.array(content).max(500),
  }),
  z.object({ type: z.literal('table'), rows: z.array(z.array(text).max(20)).max(500) }),
  z.object({
    type: z.literal('image'),
    // Only pictures carried in the request itself: the worker never fetches a URL.
    href: z.string().regex(/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/),
    width: z.number().positive().max(500),
    height: z.number().positive().max(500),
  }),
  z.object({ type: z.literal('pageBreak') }),
]);

const jitter = z.object({
  baselineDrift: z.number().min(0).max(3),
  lineSlope: z.number().min(0).max(5),
  rotation: z.number().min(0).max(10),
  size: z.number().min(0).max(0.5),
  wordSpacing: z.number().min(0).max(1),
  letterSpacing: z.number().min(0).max(0.5),
  slant: z.number().min(-30).max(30),
  slantVariation: z.number().min(0).max(15),
  strokeWidth: z.number().min(0).max(0.5),
  marginDrift: z.number().min(0).max(6),
  warp: z.number().min(0).max(0.3),
  tracking: z.number().min(-0.3).max(0.5),
  fatigue: z.number().min(0).max(1),
});

const options = z.strictObject({
  seed: z.union([z.string().max(200), z.number()]),
  pageSize: z.enum(['A4', 'Letter', 'A5']).optional(),
  margins: z
    .strictObject({
      top: z.number().min(0).max(100),
      right: z.number().min(0).max(100),
      bottom: z.number().min(0).max(100),
      left: z.number().min(0).max(100),
    })
    .partial()
    .optional(),
  lineHeight: z.number().min(4).max(30).optional(),
  xHeight: z.number().min(1).max(12).optional(),
  paragraphSpacing: z.number().min(0).max(5).optional(),
  ink: z.enum(['ballpoint-blue', 'ballpoint-black', 'gel', 'fountain', 'pencil']).optional(),
  inkColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  penWidth: z.number().min(0.1).max(2).optional(),
  jitter: jitter.optional(),
  paper: z
    .strictObject({
      kind: z.enum(['plain', 'ruled', 'graph', 'dotted']),
      ruling: z.enum(['narrow', 'college', 'wide']).optional(),
      marginLine: z.boolean().optional(),
    })
    .optional(),
  bigrams: z.number().min(0).max(1).optional(),
  corrections: z.number().min(0).max(1).optional(),
  header: z
    .array(z.strictObject({ label: z.string().max(60).optional(), value: z.string().max(120) }))
    .max(8)
    .optional(),
  headerOnEveryPage: z.boolean().optional(),
  pageNumbers: z.boolean().optional(),
});

/** Everything needed to produce a document. The same request always gives the same PDF. */
export const exportRequestSchema = z.strictObject({
  blocks: z.array(block).min(1).max(5000),
  bank: z.strictObject({
    metadata: glyphMetadataSchema,
    files: z.record(z.string().max(100), z.string().max(200_000)),
  }),
  options,
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
