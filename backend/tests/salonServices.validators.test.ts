// backend/tests/salonServices.validators.test.ts
import { describe, it, expect } from 'vitest';
import { addServiceBodySchema, serviceIdParamSchema } from '../src/validators/salonServices.validators';

describe('addServiceBodySchema', () => {
  it('accepts a normal name', () => {
    expect(addServiceBodySchema.parse({ name: 'hair cutting' })).toEqual({ name: 'hair cutting' });
  });

  it('trims and collapses extra spaces', () => {
    expect(addServiceBodySchema.parse({ name: '  head   massage ' }).name).toBe('head massage');
  });

  it('accepts non-English names and basic punctuation', () => {
    expect(addServiceBodySchema.parse({ name: 'बाल कटाई' }).name).toBe('बाल कटाई');
    expect(addServiceBodySchema.parse({ name: 'Hair & beard (combo)' }).name).toBe('Hair & beard (combo)');
    expect(addServiceBodySchema.parse({ name: "Kids' cut" }).name).toBe("Kids' cut");
  });

  it('rejects names that are too short or too long', () => {
    expect(() => addServiceBodySchema.parse({ name: '' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: '   ' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: 'a' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: '  a  ' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: 'x'.repeat(31) })).toThrow();
  });

  it('accepts the length boundaries', () => {
    expect(addServiceBodySchema.parse({ name: 'ab' }).name).toBe('ab');
    expect(addServiceBodySchema.parse({ name: 'x'.repeat(30) }).name).toHaveLength(30);
  });

  it('rejects markup and odd characters', () => {
    expect(() => addServiceBodySchema.parse({ name: '<script>alert(1)</script>' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: 'cut; drop table' })).toThrow();
  });

  it('turns line breaks and tabs into a single space instead of rejecting', () => {
    expect(addServiceBodySchema.parse({ name: 'cut\nbeard' }).name).toBe('cut beard');
    expect(addServiceBodySchema.parse({ name: 'cut\t\tbeard' }).name).toBe('cut beard');
  });

  it('rejects a missing or non-string name', () => {
    expect(() => addServiceBodySchema.parse({})).toThrow();
    expect(() => addServiceBodySchema.parse({ name: 5 })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: null })).toThrow();
  });

  it('rejects fields the barber must not send', () => {
    expect(() => addServiceBodySchema.parse({ name: 'Ok name', salonId: 'x' })).toThrow();
    expect(() => addServiceBodySchema.parse({ name: 'Ok name', deletedAt: null })).toThrow();
  });
});

describe('serviceIdParamSchema', () => {
  it('accepts a uuid', () => {
    const id = '3f2b8c9e-5a41-4d7e-9c1a-0b6e2f4d8a71';
    expect(serviceIdParamSchema.parse({ serviceId: id })).toEqual({ serviceId: id });
  });

  it('rejects anything that is not a uuid', () => {
    expect(() => serviceIdParamSchema.parse({ serviceId: 'abc' })).toThrow();
    expect(() => serviceIdParamSchema.parse({ serviceId: '1; drop table' })).toThrow();
    expect(() => serviceIdParamSchema.parse({})).toThrow();
  });
});