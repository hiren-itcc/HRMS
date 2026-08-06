import { DEFAULT_ASSET_CATEGORIES } from '@hrms/shared';
import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { OrgFixtures } from './org';
import type { People, SeededPerson } from './people';
import type { Random } from './random';

interface Spec {
  make: string;
  model: string;
  cost: [number, number];
}

/** The fallback for a category nobody listed, and the largest list besides. */
const LAPTOPS: Spec[] = [
  { make: 'Apple', model: 'MacBook Pro 14', cost: [180_000, 240_000] },
  { make: 'Dell', model: 'Latitude 5450', cost: [85_000, 110_000] },
  { make: 'Lenovo', model: 'ThinkPad T14', cost: [95_000, 125_000] },
];

const MODELS: Record<string, Spec[]> = {
  Laptop: LAPTOPS,
  Desktop: [{ make: 'HP', model: 'EliteDesk 800', cost: [60_000, 80_000] }],
  Monitor: [{ make: 'Dell', model: 'U2723QE 27"', cost: [38_000, 48_000] }],
  'Mobile phone': [{ make: 'Samsung', model: 'Galaxy S24', cost: [70_000, 90_000] }],
  'SIM card': [{ make: 'Airtel', model: 'Corporate postpaid', cost: [0, 0] }],
  'Access card': [{ make: 'HID', model: 'Proximity card', cost: [500, 900] }],
  Headset: [{ make: 'Jabra', model: 'Evolve2 40', cost: [12_000, 18_000] }],
  Furniture: [{ make: 'Featherlite', model: 'Ergonomic chair', cost: [22_000, 32_000] }],
};

/**
 * The register, with every status represented and a return still outstanding.
 *
 * The last part matters most: one of the people serving notice is still
 * holding a laptop, so their exit clearance has a real reason to block. An
 * asset gate that nothing ever trips is a gate nobody can tell works.
 */
export async function seedAssets(
  prisma: PrismaClient,
  orgId: string,
  org: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
) {
  const categories = await Promise.all(
    DEFAULT_ASSET_CATEGORIES.map((name) =>
      prisma.assetCategory.create({ data: { organizationId: orgId, name } }),
    ),
  );

  const it = people.usr('admin@hrms.local');
  const holders = people.staff.filter((p) => p.role === 'EMPLOYEE' || p.role === 'MANAGER');
  const leaver = people.all.find((p) => p.status === 'ON_NOTICE') as SeededPerson;

  let tagNumber = 1;
  const nextTag = (prefix: string) => `${prefix}-${String(tagNumber++).padStart(4, '0')}`;

  /** Issued, and still out. */
  const issue = async (
    person: SeededPerson,
    categoryName: string,
    over: { status?: 'ASSIGNED'; issuedBack: number } = { issuedBack: 90 },
  ) => {
    const category = categories.find((c) => c.name === categoryName) as (typeof categories)[number];
    const spec = random.pick(MODELS[categoryName] ?? LAPTOPS);
    const asset = await prisma.asset.create({
      data: {
        organizationId: orgId,
        categoryId: category.id,
        assetTag: nextTag(categoryName.slice(0, 3).toUpperCase()),
        name: `${spec.make} ${spec.model}`,
        serialNumber: `SN-${random.int(1000, 9999)}${random.int(100, 999)}`,
        make: spec.make,
        model: spec.model,
        status: 'ASSIGNED',
        condition: 'GOOD',
        purchaseDate: toDate(addDays(todayKey, -random.int(200, 900))),
        purchaseCost: random.step(spec.cost[0], spec.cost[1] || 1, 500) || null,
        warrantyEnd: toDate(addDays(todayKey, random.int(-100, 700))),
        vendor: random.pick(['Redington', 'Ingram Micro', 'Direct from vendor']),
        locationId: person.locationId,
      },
    });
    await prisma.assetAssignment.create({
      data: {
        assetId: asset.id,
        employeeId: person.employeeId,
        issuedOn: toDate(addDays(todayKey, -over.issuedBack)),
        issuedById: it,
        conditionOut: 'GOOD',
        notes: 'Issued on joining',
      },
    });
    return asset;
  };

  // A laptop and an access card each for most of the staff.
  for (const [i, person] of holders.entries()) {
    await issue(person, 'Laptop', { issuedBack: random.int(60, 700) });
    if (i % 2 === 0) await issue(person, 'Access card', { issuedBack: random.int(60, 700) });
    if (i % 3 === 0) await issue(person, 'Monitor', { issuedBack: random.int(60, 700) });
  }

  // The one that blocks an exit: still out, and its holder is leaving.
  if (leaver) await issue(leaver, 'Mobile phone', { issuedBack: 200 });

  // Returned history, so the register can answer "who had it in March".
  const returnedLaptop = await prisma.asset.create({
    data: {
      organizationId: orgId,
      categoryId: (categories.find((c) => c.name === 'Laptop') as (typeof categories)[number]).id,
      assetTag: nextTag('LAP'),
      name: 'Dell Latitude 5430',
      serialNumber: `SN-${random.int(1000, 9999)}200`,
      make: 'Dell',
      model: 'Latitude 5430',
      status: 'IN_STOCK',
      condition: 'FAIR',
      purchaseDate: toDate(addDays(todayKey, -1100)),
      purchaseCost: 82_000,
      vendor: 'Redington',
      locationId: org.location('Ahmedabad').id,
      notes: 'Back from a leaver; battery health poor',
    },
  });
  const goneAlready = people.all.filter((p) => p.status === 'EXITED');
  for (const [i, person] of goneAlready.entries()) {
    await prisma.assetAssignment.create({
      data: {
        assetId: returnedLaptop.id,
        employeeId: person.employeeId,
        issuedOn: toDate(addDays(todayKey, -700 + i * 200)),
        issuedById: it,
        conditionOut: 'GOOD',
        returnedOn: toDate(addDays(todayKey, -400 + i * 120)),
        returnedById: it,
        conditionIn: 'FAIR',
        notes: 'Returned at exit',
      },
    });
    if (i === 0) break; // one open-and-closed spell is enough to show the shape
  }

  // Spare stock, and the three statuses set by hand.
  const spares: {
    category: string;
    status: 'IN_STOCK' | 'IN_REPAIR' | 'LOST' | 'RETIRED';
    condition: 'NEW' | 'GOOD' | 'FAIR' | 'DAMAGED';
    notes?: string;
  }[] = [
    { category: 'Laptop', status: 'IN_STOCK', condition: 'NEW' },
    { category: 'Laptop', status: 'IN_STOCK', condition: 'NEW' },
    { category: 'Desktop', status: 'IN_STOCK', condition: 'GOOD' },
    { category: 'Monitor', status: 'IN_STOCK', condition: 'GOOD' },
    { category: 'Headset', status: 'IN_STOCK', condition: 'NEW' },
    { category: 'Headset', status: 'IN_STOCK', condition: 'NEW' },
    {
      category: 'Laptop',
      status: 'IN_REPAIR',
      condition: 'DAMAGED',
      notes: 'Screen replacement — with the vendor since last week',
    },
    {
      category: 'Mobile phone',
      status: 'LOST',
      condition: 'GOOD',
      notes: 'Reported lost in transit; police complaint filed',
    },
    {
      category: 'Desktop',
      status: 'RETIRED',
      condition: 'DAMAGED',
      notes: 'Seven years old, beyond economic repair',
    },
    { category: 'Furniture', status: 'IN_STOCK', condition: 'GOOD' },
    { category: 'SIM card', status: 'IN_STOCK', condition: 'NEW' },
  ];

  for (const spare of spares) {
    const category = categories.find(
      (c) => c.name === spare.category,
    ) as (typeof categories)[number];
    const spec = random.pick(MODELS[spare.category] ?? LAPTOPS);
    await prisma.asset.create({
      data: {
        organizationId: orgId,
        categoryId: category.id,
        assetTag: nextTag(spare.category.slice(0, 3).toUpperCase()),
        name: `${spec.make} ${spec.model}`,
        serialNumber: `SN-${random.int(1000, 9999)}${random.int(100, 999)}`,
        make: spec.make,
        model: spec.model,
        status: spare.status,
        condition: spare.condition,
        purchaseDate: toDate(addDays(todayKey, -random.int(200, 2000))),
        purchaseCost: random.step(spec.cost[0], spec.cost[1] || 1, 500) || null,
        vendor: random.pick(['Redington', 'Ingram Micro', 'Direct from vendor']),
        locationId: org.location(random.pick(['Ahmedabad', 'Pune', 'Bengaluru'])).id,
        notes: spare.notes,
      },
    });
  }

  return { leaverStillHolding: leaver?.email ?? null };
}
