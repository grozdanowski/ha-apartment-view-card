import { describe, expect, it } from 'vitest';
import {
  CURRENT_CONTENT_VERSION,
  CURRENT_EXPERIENCE_VERSION,
  normalizeConfig,
} from '../src/core/config';

const baseConfig = (patch: Record<string, unknown> = {}) => ({
  images: { base: '/local/apartment.png' },
  ...patch,
});

describe('immersive experience config', () => {
  it('supplies conservative responsive, motion, and quality defaults', () => {
    const config = normalizeConfig(baseConfig());

    expect(config.experience).toEqual({
      version: CURRENT_EXPERIENCE_VERSION,
      intro: { title: 'Home', subtitle: '', presenceEntities: [] },
      mobile: {
        expandedHeight: 340,
        compactHeight: 200,
        bottomInset: 100,
      },
      fixedPosition: { mobile: false, desktop: false },
      landscape: { spatialRatio: 0.45 },
      motion: { resetSeconds: 10, transitionMs: 900, orbitSeconds: 90 },
      quality: 'auto',
    });
  });

  it('normalizes known values and preserves future keys at every level', () => {
    const config = normalizeConfig(
      baseConfig({
        experience: {
          version: 99,
          rendererHint: 'future',
          intro: {
            title: 'Good evening',
            subtitle: 'Everything is calm',
            eyebrow: 'Friday',
          },
          mobile: {
            expandedHeight: 180,
            compactHeight: 900,
            bottomInset: 24,
            snap: true,
          },
          fixedPosition: { mobile: false, desktop: true, future: 'keep' },
          landscape: { spatialRatio: 0.9, placement: 'start' },
          motion: {
            resetSeconds: -1,
            transitionMs: 850,
            orbitSeconds: 120,
            easing: 'spring',
          },
          quality: 'high',
        },
      }),
    );

    expect(config.experience).toMatchObject({
      version: CURRENT_EXPERIENCE_VERSION,
      rendererHint: 'future',
      intro: {
        title: 'Good evening',
        subtitle: 'Everything is calm',
        eyebrow: 'Friday',
      },
      mobile: {
        expandedHeight: 240,
        compactHeight: 240,
        bottomInset: 24,
        snap: true,
      },
      fixedPosition: { mobile: false, desktop: true, future: 'keep' },
      landscape: { spatialRatio: 0.75, placement: 'start' },
      motion: {
        resetSeconds: 0,
        transitionMs: 850,
        orbitSeconds: 120,
        easing: 'spring',
      },
      quality: 'high',
    });
  });

  it('falls back field-by-field for malformed experience input', () => {
    const config = normalizeConfig(
      baseConfig({
        experience: {
          intro: 'welcome',
          mobile: null,
          landscape: { spatialRatio: 'wide' },
          motion: { transitionMs: Number.NaN },
          quality: 'ultra',
        },
      }),
    );

    expect(config.experience.intro).toEqual({ title: 'Home', subtitle: '', presenceEntities: [] });
    expect(config.experience.mobile.expandedHeight).toBe(340);
    expect(config.experience.landscape.spatialRatio).toBe(0.45);
    expect(config.experience.motion.transitionMs).toBe(900);
    expect(config.experience.quality).toBe('auto');
    expect(config.experience.fixedPosition).toEqual({ mobile: false, desktop: false });
  });
});

describe('immersive content config', () => {
  it('defaults to empty ordered overview and room content', () => {
    expect(normalizeConfig(baseConfig()).content).toEqual({
      version: CURRENT_CONTENT_VERSION,
      overview: [],
      rooms: {},
    });
  });

  it('normalizes every block type in order, including nested conditions', () => {
    const config = normalizeConfig(
      baseConfig({
        content: {
          version: 88,
          layoutHint: 'future',
          overview: [
            {
              type: 'heading',
              title: 'At a glance',
              subtitle: 'Live state',
              level: 2,
            },
            {
              type: 'spatial-controls',
              entities: ['light.kitchen', 4, '', 'climate.hall'],
            },
            {
              type: 'action',
              title: 'Movie mode',
              icon: 'mdi:movie',
              action: { action: 'call-service', service: 'scene.turn_on' },
            },
            {
              type: 'lovelace-card',
              card: { type: 'weather-forecast', entity: 'weather.home' },
            },
            {
              type: 'condition',
              conditions: [
                {
                  condition: 'state',
                  entity: 'sun.sun',
                  state: 'below_horizon',
                },
                null,
              ],
              blocks: [
                { type: 'spacer', size: 500 },
                { type: 'heading', title: 'After dark' },
              ],
            },
            { type: 'future-block', payload: { enabled: true } },
          ],
          rooms: {
            kitchen: [
              { type: 'spatial-controls', entities: ['light.kitchen'] },
            ],
            empty: 'invalid',
          },
        },
      }),
    );

    expect(config.content.version).toBe(CURRENT_CONTENT_VERSION);
    expect(config.content.layoutHint).toBe('future');
    expect(config.content.overview.map((block) => block.type)).toEqual([
      'heading',
      'spatial-controls',
      'action',
      'lovelace-card',
      'condition',
      'future-block',
    ]);
    expect(config.content.overview[0]).toMatchObject({ level: 2 });
    expect(config.content.overview[1]).toMatchObject({
      entities: ['light.kitchen', 'climate.hall'],
    });
    expect(config.content.overview[3]).toMatchObject({
      card: { type: 'weather-forecast', entity: 'weather.home' },
    });
    expect(config.content.overview[4]).toMatchObject({
      conditions: [
        { condition: 'state', entity: 'sun.sun', state: 'below_horizon' },
      ],
      blocks: [
        { type: 'spacer', size: 320 },
        { type: 'heading', title: 'After dark' },
      ],
    });
    expect(config.content.overview[5]).toMatchObject({
      type: 'future-block',
      payload: { enabled: true },
    });
    expect(config.content.rooms.kitchen).toHaveLength(1);
    expect(config.content.rooms.empty).toEqual([]);
  });

  it('uses inert defaults for incomplete action and nested-card blocks', () => {
    const config = normalizeConfig(
      baseConfig({
        content: {
          overview: [
            { type: 'action' },
            { type: 'lovelace-card', card: { entity: 'sensor.missing_type' } },
            null,
            { title: 'missing discriminator' },
          ],
        },
      }),
    );

    expect(config.content.overview).toHaveLength(2);
    expect(config.content.overview[0]).toMatchObject({
      type: 'action',
      title: '',
      action: { action: 'none' },
    });
    expect(config.content.overview[1]).toEqual({
      type: 'lovelace-card',
      card: { type: 'markdown', content: '' },
    });
  });
});
