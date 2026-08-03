import type { LocationType } from '@hrms/types';

export interface Company {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  logoUrl: string | null;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  _count: { children: number; employees: number };
}

export interface Designation {
  id: string;
  title: string;
  level: number;
  _count: { employees: number };
}

export interface EmploymentTypeRow {
  id: string;
  name: string;
  code: string | null;
  _count: { employees: number };
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string | null;
  /** The attendance geofence; null coordinates mean this office verifies nobody. */
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters: number;
  _count: { employees: number; holidays: number };
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  _count: { employees: number };
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  isOptional: boolean;
  locationId: string | null;
  location: { id: string; name: string } | null;
}

export interface Option {
  id: string;
  name: string;
}
