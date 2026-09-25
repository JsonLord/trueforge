import type { FastPathAdmissionMetadata } from './FastPathAdmission';

export type RequestComplexity = 'simple' | 'reasoning' | 'unknown';
export type RequestActionClass = 'read' | 'write' | 'destructive' | 'external_side_effect' | 'unknown';

export interface RequestClassification {
  complexity: RequestComplexity;
  actionClass: RequestActionClass;
  confidence: number;
}

export interface RequestClassifier {
  classify(input: { query: string; toolsAvailable: boolean }): Promise<RequestClassification>;
}

export interface RequestMetadata {
  classification: RequestClassification | undefined;
  fastPathAdmission: FastPathAdmissionMetadata | undefined;
}
