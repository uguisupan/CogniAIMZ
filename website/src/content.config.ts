import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
    // Astro v5 glob loader
    loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/blog" }),
    schema: z.object({
        title: z.string(),
        pubDate: z.coerce.date(),
        tag: z.string(),
        description: z.string().optional(),
    }),
});

export const collections = { blog };
