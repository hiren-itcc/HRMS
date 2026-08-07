/**
 * react-hook-form bindings for the design-system controls.
 *
 * These live in `apps/web` rather than `packages/ui` on purpose: the UI package
 * has no react-hook-form dependency and must not gain one (doc 01's dependency
 * direction). These components join the two, so they belong to the app.
 *
 * `@/components/field` is unchanged and still supported — it is the right tool
 * for anything without a wrapper here. `FormField` is that same escape hatch
 * with the form binding attached.
 */
export { type FieldA11y, FormField, type FormFieldProps } from './form-base';
export { FormCheckbox, FormSwitch } from './form-checkbox';
export { FormDatePicker, FormTimePicker } from './form-date';
export { FormInput, FormTextarea } from './form-input';
export { FormSelect } from './form-select';
