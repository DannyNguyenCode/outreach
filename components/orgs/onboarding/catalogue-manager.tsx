"use client";

import { useActionState } from "react";

import {
  createProductAction,
  createServiceAction,
  deactivateProductAction,
  deactivateServiceAction,
  markCatalogueStepAction,
} from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  priceDescription: string | null;
  durationMinutes: number | null;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sku: string | null;
  priceDescription: string | null;
};

export function CatalogueManager({
  organizationSlug,
  businessType,
  services,
  products,
  canManage,
  markStep = true,
  onboardingExpectedVersion,
}: {
  organizationSlug: string;
  businessType: string | null;
  services: ServiceRow[];
  products: ProductRow[];
  canManage: boolean;
  markStep?: boolean;
  onboardingExpectedVersion?: number;
}) {
  const showServices =
    businessType === "SERVICES" || businessType === "BOTH" || !businessType;
  const showProducts =
    businessType === "PRODUCTS" || businessType === "BOTH" || !businessType;

  return (
    <div className="space-y-8">
      {showServices ? (
        <section className="space-y-4" aria-labelledby="services-heading">
          <h2 id="services-heading" className="text-lg font-semibold">
            Services
          </h2>
          <ul className="space-y-2">
            {services.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">No services yet.</li>
            ) : (
              services.map((service) => (
                <li
                  key={service.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {service.name}
                      {!service.isActive ? (
                        <span className="ml-2 text-[var(--muted)]">
                          (inactive)
                        </span>
                      ) : null}
                    </p>
                    {service.priceDescription ? (
                      <p className="text-[var(--muted)]">
                        {service.priceDescription}
                      </p>
                    ) : null}
                  </div>
                  {canManage && service.isActive ? (
                    <DeactivateServiceButton
                      organizationSlug={organizationSlug}
                      serviceId={service.id}
                    />
                  ) : null}
                </li>
              ))
            )}
          </ul>
          {canManage ? (
            <CreateServiceForm organizationSlug={organizationSlug} />
          ) : null}
        </section>
      ) : null}

      {showProducts ? (
        <section className="space-y-4" aria-labelledby="products-heading">
          <h2 id="products-heading" className="text-lg font-semibold">
            Products
          </h2>
          <ul className="space-y-2">
            {products.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">No products yet.</li>
            ) : (
              products.map((product) => (
                <li
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {product.name}
                      {!product.isActive ? (
                        <span className="ml-2 text-[var(--muted)]">
                          (inactive)
                        </span>
                      ) : null}
                    </p>
                    {product.sku ? (
                      <p className="text-[var(--muted)]">SKU: {product.sku}</p>
                    ) : null}
                  </div>
                  {canManage && product.isActive ? (
                    <DeactivateProductButton
                      organizationSlug={organizationSlug}
                      productId={product.id}
                    />
                  ) : null}
                </li>
              ))
            )}
          </ul>
          {canManage ? (
            <CreateProductForm organizationSlug={organizationSlug} />
          ) : null}
        </section>
      ) : null}

      {canManage && markStep && onboardingExpectedVersion !== undefined ? (
        <MarkCatalogueStepForm
          organizationSlug={organizationSlug}
          onboardingExpectedVersion={onboardingExpectedVersion}
        />
      ) : null}
    </div>
  );
}

function CreateServiceForm({ organizationSlug }: { organizationSlug: string }) {
  const [state, formAction] = useActionState(
    createServiceAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="service-name" className="block text-sm font-medium">
            Service name
          </label>
          <input
            id="service-name"
            name="name"
            required
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="service-name-error"
            errors={state.fieldErrors?.name}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="service-price" className="block text-sm font-medium">
            Price description
          </label>
          <input
            id="service-price"
            name="priceDescription"
            placeholder="Starting at $99"
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor="service-duration"
            className="block text-sm font-medium"
          >
            Duration (minutes)
          </label>
          <input
            id="service-duration"
            name="durationMinutes"
            type="number"
            min={1}
            max={1440}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="service-category"
            className="block text-sm font-medium"
          >
            Category
          </label>
          <input
            id="service-category"
            name="category"
            maxLength={80}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="service-description"
          className="block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="service-description"
          name="description"
          rows={2}
          maxLength={1000}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <SubmitButton pendingLabel="Adding…">Add service</SubmitButton>
    </form>
  );
}

function CreateProductForm({ organizationSlug }: { organizationSlug: string }) {
  const [state, formAction] = useActionState(
    createProductAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="product-name" className="block text-sm font-medium">
            Product name
          </label>
          <input
            id="product-name"
            name="name"
            required
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="product-name-error"
            errors={state.fieldErrors?.name}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="product-sku" className="block text-sm font-medium">
            SKU
          </label>
          <input
            id="product-sku"
            name="sku"
            maxLength={64}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id="product-sku-error" errors={state.fieldErrors?.sku} />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="product-price" className="block text-sm font-medium">
          Price description
        </label>
        <input
          id="product-price"
          name="priceDescription"
          maxLength={120}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="product-description"
          className="block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="product-description"
          name="description"
          rows={2}
          maxLength={1000}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <SubmitButton pendingLabel="Adding…">Add product</SubmitButton>
    </form>
  );
}

function DeactivateServiceButton({
  organizationSlug,
  serviceId,
}: {
  organizationSlug: string;
  serviceId: string;
}) {
  const [state, formAction] = useActionState(
    deactivateServiceAction,
    initialActionState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
      <FormStatus status={state.status} message={state.message} />
    </form>
  );
}

function DeactivateProductButton({
  organizationSlug,
  productId,
}: {
  organizationSlug: string;
  productId: string;
}) {
  const [state, formAction] = useActionState(
    deactivateProductAction,
    initialActionState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="productId" value={productId} />
      <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
      <FormStatus status={state.status} message={state.message} />
    </form>
  );
}

function MarkCatalogueStepForm({
  organizationSlug,
  onboardingExpectedVersion,
}: {
  organizationSlug: string;
  onboardingExpectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    markCatalogueStepAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input
        type="hidden"
        name="onboardingExpectedVersion"
        value={onboardingExpectedVersion}
      />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Saving…">
        Continue to employee defaults
      </SubmitButton>
    </form>
  );
}
