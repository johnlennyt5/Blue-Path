/**
 * XAML template layer (S4-1, ARCHITECTURE §7.3): typed activity model →
 * UiPath-compatible XAML. This module is the ONLY place XAML text is
 * produced — everything upstream builds `XActivity` trees, never strings.
 *
 * Target: UiPath Studio 2023.10+ (Windows-legacy compatibility, VB
 * expressions, .NET 6).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** UiPath-side variable/argument types (BP types map onto these in S4-4). */
export type XamlType =
  | 'String'
  | 'Double'
  | 'Boolean'
  | 'DateTime'
  | 'Int32'
  | 'Object'
  | 'DataTable'
  | 'QueueItem';

export interface XamlVariable {
  name: string;
  type: XamlType;
  /** VB default-value expression (without brackets). */
  defaultExpression?: string;
}

export interface XamlArgument {
  name: string;
  direction: 'in' | 'out' | 'inout';
  type: XamlType;
}

export interface InvokeArgumentBinding {
  name: string;
  direction: 'in' | 'out' | 'inout';
  type: XamlType;
  /** VB expression for in-arguments; variable name for out/inout-arguments. */
  expression: string;
}

export interface XamlCatch {
  exceptionType: 'Exception' | 'BusinessRuleException';
  body?: XActivity;
}

export type XActivity =
  | {
      kind: 'sequence';
      displayName?: string;
      variables?: XamlVariable[];
      activities: XActivity[];
    }
  | { kind: 'assign'; displayName?: string; to: string; value: string; type: XamlType }
  | { kind: 'if'; displayName?: string; condition: string; then?: XActivity; else?: XActivity }
  | {
      kind: 'forEachRow';
      displayName?: string;
      dataTable: string;
      rowName?: string;
      body: XActivity;
    }
  | {
      kind: 'tryCatch';
      displayName?: string;
      tryBody: XActivity;
      catches: XamlCatch[];
      finallyBody?: XActivity;
    }
  | {
      kind: 'invokeWorkflow';
      displayName?: string;
      workflowFile: string;
      arguments: InvokeArgumentBinding[];
    }
  | { kind: 'writeLine'; displayName?: string; text: string }
  | {
      kind: 'throw';
      displayName?: string;
      exception: 'BusinessRuleException' | 'Exception';
      /** VB expression for the exception message (already quoted if literal). */
      message: string;
    }
  | { kind: 'comment'; text: string }
  | { kind: 'rethrow'; displayName?: string }
  | { kind: 'typeInto'; displayName?: string; selector: string; text: string }
  | { kind: 'getText'; displayName?: string; selector: string; storeIn: string }
  | { kind: 'click'; displayName?: string; selector: string }
  | {
      kind: 'elementExists';
      displayName?: string;
      selector: string;
      storeIn: string;
      timeoutMs?: number;
    }
  | {
      kind: 'invokeCode';
      displayName?: string;
      language: 'VBNet' | 'CSharp';
      code: string;
      arguments: InvokeArgumentBinding[];
    }
  | {
      kind: 'addQueueItem';
      displayName?: string;
      /** Literal queue name, or a VB expression when `queueNameIsExpression`. */
      queueName: string;
      queueNameIsExpression?: boolean;
      itemInformation: { name: string; expression: string }[];
    }
  | {
      kind: 'getTransactionItem';
      displayName?: string;
      queueName: string;
      queueNameIsExpression?: boolean;
      /** Variable receiving the ui:QueueItem. */
      storeIn: string;
    }
  | {
      kind: 'setTransactionStatus';
      displayName?: string;
      status: 'Successful' | 'Failed';
      /** VB expression for the QueueItem. */
      transactionItem: string;
      errorType?: 'Application' | 'Business';
      /** VB expression for the failure reason. */
      reason?: string;
    };

export interface WorkflowDoc {
  /** x:Class — must be a valid identifier. */
  className: string;
  arguments: XamlArgument[];
  body: XActivity;
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const TYPE_REF: Record<XamlType, string> = {
  String: 'x:String',
  Double: 'x:Double',
  Boolean: 'x:Boolean',
  DateTime: 's:DateTime',
  Int32: 'x:Int32',
  Object: 'x:Object',
  DataTable: 'sd:DataTable',
  QueueItem: 'ui:QueueItem',
};

const ARG_WRAPPER: Record<XamlArgument['direction'], string> = {
  in: 'InArgument',
  out: 'OutArgument',
  inout: 'InOutArgument',
};

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** VB expression as XAML expression text: wrapped in [ ] and escaped. */
const expr = (vb: string): string => escapeXml(`[${vb}]`);

class Writer {
  private lines: string[] = [];
  private depth = 0;

  line(text: string): void {
    this.lines.push(`${'  '.repeat(this.depth)}${text}`);
  }

  block(open: string, close: string, body: () => void): void {
    this.line(open);
    this.depth += 1;
    body();
    this.depth -= 1;
    this.line(close);
  }

  toString(): string {
    return `${this.lines.join('\r\n')}\r\n`;
  }
}

const displayAttr = (displayName: string | undefined, fallback: string): string =>
  ` DisplayName="${escapeXml(displayName ?? fallback)}"`;

function emitVariables(w: Writer, variables: XamlVariable[]): void {
  if (variables.length === 0) return;
  w.block('<Sequence.Variables>', '</Sequence.Variables>', () => {
    for (const variable of variables) {
      const defaultAttr =
        variable.defaultExpression !== undefined
          ? ` Default="${expr(variable.defaultExpression)}"`
          : '';
      w.line(
        `<Variable x:TypeArguments="${TYPE_REF[variable.type]}"${defaultAttr} Name="${escapeXml(variable.name)}" />`,
      );
    }
  });
}

function emitActivity(w: Writer, activity: XActivity): void {
  switch (activity.kind) {
    case 'sequence':
      w.block(`<Sequence${displayAttr(activity.displayName, 'Sequence')}>`, '</Sequence>', () => {
        emitVariables(w, activity.variables ?? []);
        for (const child of activity.activities) emitActivity(w, child);
      });
      return;

    case 'assign':
      w.block(`<Assign${displayAttr(activity.displayName, `Assign ${activity.to}`)}>`, '</Assign>', () => {
        w.block('<Assign.To>', '</Assign.To>', () => {
          w.line(
            `<OutArgument x:TypeArguments="${TYPE_REF[activity.type]}">${expr(activity.to)}</OutArgument>`,
          );
        });
        w.block('<Assign.Value>', '</Assign.Value>', () => {
          w.line(
            `<InArgument x:TypeArguments="${TYPE_REF[activity.type]}">${expr(activity.value)}</InArgument>`,
          );
        });
      });
      return;

    case 'if':
      w.block(
        `<If Condition="${expr(activity.condition)}"${displayAttr(activity.displayName, 'If')}>`,
        '</If>',
        () => {
          if (activity.then) {
            w.block('<If.Then>', '</If.Then>', () => emitActivity(w, activity.then!));
          }
          if (activity.else) {
            w.block('<If.Else>', '</If.Else>', () => emitActivity(w, activity.else!));
          }
        },
      );
      return;

    case 'forEachRow': {
      const rowName = activity.rowName ?? 'CurrentRow';
      w.block(
        `<ui:ForEachRow DataTable="${expr(activity.dataTable)}"${displayAttr(activity.displayName, `For Each Row in ${activity.dataTable}`)}>`,
        '</ui:ForEachRow>',
        () => {
          w.block('<ui:ForEachRow.Body>', '</ui:ForEachRow.Body>', () => {
            w.block('<ActivityAction x:TypeArguments="sd:DataRow">', '</ActivityAction>', () => {
              w.block('<ActivityAction.Argument>', '</ActivityAction.Argument>', () => {
                w.line(
                  `<DelegateInArgument x:TypeArguments="sd:DataRow" Name="${escapeXml(rowName)}" />`,
                );
              });
              emitActivity(w, activity.body);
            });
          });
        },
      );
      return;
    }

    case 'tryCatch':
      w.block(`<TryCatch${displayAttr(activity.displayName, 'Try Catch')}>`, '</TryCatch>', () => {
        w.block('<TryCatch.Try>', '</TryCatch.Try>', () => emitActivity(w, activity.tryBody));
        if (activity.catches.length > 0) {
          w.block('<TryCatch.Catches>', '</TryCatch.Catches>', () => {
            for (const c of activity.catches) {
              const typeRef =
                c.exceptionType === 'BusinessRuleException'
                  ? 'ui:BusinessRuleException'
                  : 's:Exception';
              w.block(`<Catch x:TypeArguments="${typeRef}">`, '</Catch>', () => {
                w.block(
                  `<ActivityAction x:TypeArguments="${typeRef}">`,
                  '</ActivityAction>',
                  () => {
                    w.block('<ActivityAction.Argument>', '</ActivityAction.Argument>', () => {
                      w.line(
                        `<DelegateInArgument x:TypeArguments="${typeRef}" Name="exception" />`,
                      );
                    });
                    if (c.body) emitActivity(w, c.body);
                  },
                );
              });
            }
          });
        }
        if (activity.finallyBody) {
          w.block('<TryCatch.Finally>', '</TryCatch.Finally>', () =>
            emitActivity(w, activity.finallyBody!),
          );
        }
      });
      return;

    case 'invokeWorkflow':
      w.block(
        `<ui:InvokeWorkflowFile UnSafe="False" WorkflowFileName="${escapeXml(activity.workflowFile)}"${displayAttr(activity.displayName, `Invoke ${activity.workflowFile}`)}>`,
        '</ui:InvokeWorkflowFile>',
        () => {
          if (activity.arguments.length > 0) {
            w.block(
              '<ui:InvokeWorkflowFile.Arguments>',
              '</ui:InvokeWorkflowFile.Arguments>',
              () => {
                for (const arg of activity.arguments) {
                  const wrapper =
                    arg.direction === 'in'
                      ? 'InArgument'
                      : arg.direction === 'out'
                        ? 'OutArgument'
                        : 'InOutArgument';
                  w.line(
                    `<${wrapper} x:TypeArguments="${TYPE_REF[arg.type]}" x:Key="${escapeXml(arg.name)}">${expr(arg.expression)}</${wrapper}>`,
                  );
                }
              },
            );
          }
        },
      );
      return;

    case 'writeLine':
      w.line(
        `<WriteLine${displayAttr(activity.displayName, 'Write Line')} Text="${expr(activity.text)}" />`,
      );
      return;

    case 'throw': {
      const cls =
        activity.exception === 'BusinessRuleException'
          ? 'UiPath.Core.BusinessRuleException'
          : 'System.Exception';
      w.line(
        `<Throw${displayAttr(activity.displayName, 'Throw')} Exception="${expr(`New ${cls}(${activity.message})`)}" />`,
      );
      return;
    }

    case 'comment':
      w.line(`<ui:Comment Text="${escapeXml(activity.text)}" />`);
      return;

    case 'rethrow':
      w.line(`<Rethrow${displayAttr(activity.displayName, 'Rethrow')} />`);
      return;

    case 'typeInto':
      w.block(
        `<ui:TypeInto${displayAttr(activity.displayName, 'Type Into')} Text="${expr(activity.text)}">`,
        '</ui:TypeInto>',
        () => {
          w.block('<ui:TypeInto.Target>', '</ui:TypeInto.Target>', () => {
            w.line(`<ui:Target Selector="${escapeXml(activity.selector)}" />`);
          });
        },
      );
      return;

    case 'getText':
      w.block(
        `<ui:GetText${displayAttr(activity.displayName, 'Get Text')}>`,
        '</ui:GetText>',
        () => {
          w.block('<ui:GetText.Target>', '</ui:GetText.Target>', () => {
            w.line(`<ui:Target Selector="${escapeXml(activity.selector)}" />`);
          });
          w.block('<ui:GetText.Value>', '</ui:GetText.Value>', () => {
            w.line(`<OutArgument x:TypeArguments="x:String">${expr(activity.storeIn)}</OutArgument>`);
          });
        },
      );
      return;

    case 'click':
      w.block(
        `<ui:Click${displayAttr(activity.displayName, 'Click')}>`,
        '</ui:Click>',
        () => {
          w.block('<ui:Click.Target>', '</ui:Click.Target>', () => {
            w.line(`<ui:Target Selector="${escapeXml(activity.selector)}" />`);
          });
        },
      );
      return;

    case 'elementExists':
      w.block(
        `<ui:UiElementExists${displayAttr(activity.displayName, 'Element Exists')}>`,
        '</ui:UiElementExists>',
        () => {
          w.block('<ui:UiElementExists.Target>', '</ui:UiElementExists.Target>', () => {
            w.line(
              `<ui:Target Selector="${escapeXml(activity.selector)}"${
                activity.timeoutMs !== undefined ? ` TimeoutMS="${activity.timeoutMs}"` : ''
              } />`,
            );
          });
          w.block('<ui:UiElementExists.Exists>', '</ui:UiElementExists.Exists>', () => {
            w.line(
              `<OutArgument x:TypeArguments="x:Boolean">${expr(activity.storeIn)}</OutArgument>`,
            );
          });
        },
      );
      return;

    case 'invokeCode': {
      const open = `<ui:InvokeCode${displayAttr(activity.displayName, 'Invoke Code')} Language="${activity.language}" Code="${escapeXml(activity.code)}"`;
      if (activity.arguments.length === 0) {
        w.line(`${open} />`);
        return;
      }
      w.block(`${open}>`, '</ui:InvokeCode>', () => {
        w.block('<ui:InvokeCode.Arguments>', '</ui:InvokeCode.Arguments>', () => {
          for (const arg of activity.arguments) {
            const wrapper =
              arg.direction === 'in'
                ? 'InArgument'
                : arg.direction === 'out'
                  ? 'OutArgument'
                  : 'InOutArgument';
            w.line(
              `<${wrapper} x:TypeArguments="${TYPE_REF[arg.type]}" x:Key="${escapeXml(arg.name)}">${expr(arg.expression)}</${wrapper}>`,
            );
          }
        });
      });
      return;
    }

    case 'addQueueItem': {
      // UiPath.Core.Activities.AddQueueItem has no QueueName member — the
      // queue name lives in QueueType, same as GetQueueItem (verified via
      // assembly metadata, 23.10.2 and 26.6.1).
      const queueAttr = activity.queueNameIsExpression
        ? expr(activity.queueName)
        : expr(JSON.stringify(activity.queueName));
      const open = `<ui:AddQueueItem${displayAttr(activity.displayName, 'Add Queue Item')} QueueType="${queueAttr}"`;
      if (activity.itemInformation.length === 0) {
        w.line(`${open} />`);
        return;
      }
      w.block(`${open}>`, '</ui:AddQueueItem>', () => {
        w.block('<ui:AddQueueItem.ItemInformation>', '</ui:AddQueueItem.ItemInformation>', () => {
          for (const item of activity.itemInformation) {
            w.line(
              `<InArgument x:TypeArguments="x:Object" x:Key="${escapeXml(item.name)}">${expr(item.expression)}</InArgument>`,
            );
          }
        });
      });
      return;
    }

    case 'getTransactionItem': {
      // Modern System.Activities: ui:GetQueueItem, queue NAME in QueueType
      // (verified against the official REFramework 25.10 template).
      const queueAttr = activity.queueNameIsExpression
        ? expr(activity.queueName)
        : expr(JSON.stringify(activity.queueName));
      w.line(
        `<ui:GetQueueItem${displayAttr(activity.displayName, 'Get Transaction Item')} QueueType="${queueAttr}" TransactionItem="${expr(activity.storeIn)}" />`,
      );
      return;
    }

    case 'setTransactionStatus': {
      const errorAttrs =
        activity.status === 'Failed'
          ? ` ErrorType="${activity.errorType ?? 'Application'}"${activity.reason !== undefined ? ` Reason="${expr(activity.reason)}"` : ''}`
          : '';
      w.line(
        `<ui:SetTransactionStatus${displayAttr(activity.displayName, `Set Transaction Status (${activity.status})`)} Status="${activity.status}"${errorAttrs} TransactionItem="${expr(activity.transactionItem)}" />`,
      );
      return;
    }
  }
}

/** Emits a complete UiPath workflow .xaml document (CRLF, UTF-8 text). */
export function emitWorkflowXaml(doc: WorkflowDoc): string {
  const w = new Writer();
  w.line('<?xml version="1.0" encoding="utf-8"?>');
  w.block(
    [
      `<Activity mc:Ignorable="sap sap2010" x:Class="${escapeXml(doc.className)}"`,
      ' xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities"',
      ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
      ' xmlns:s="clr-namespace:System;assembly=mscorlib"',
      ' xmlns:sap="http://schemas.microsoft.com/netfx/2009/xaml/activities/presentation"',
      ' xmlns:sap2010="http://schemas.microsoft.com/netfx/2010/xaml/activities/presentation"',
      ' xmlns:sco="clr-namespace:System.Collections.ObjectModel;assembly=mscorlib"',
      ' xmlns:sd="clr-namespace:System.Data;assembly=System.Data"',
      ' xmlns:ui="http://schemas.uipath.com/workflow/activities"',
      ' xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">',
    ].join(''),
    '</Activity>',
    () => {
      if (doc.arguments.length > 0) {
        w.block('<x:Members>', '</x:Members>', () => {
          for (const arg of doc.arguments) {
            w.line(
              `<x:Property Name="${escapeXml(arg.name)}" Type="${ARG_WRAPPER[arg.direction]}(${TYPE_REF[arg.type]})" />`,
            );
          }
        });
      }
      w.block(
        '<TextExpression.NamespacesForImplementation>',
        '</TextExpression.NamespacesForImplementation>',
        () => {
          w.block('<sco:Collection x:TypeArguments="x:String">', '</sco:Collection>', () => {
            for (const ns of ['System', 'System.Collections.Generic', 'System.Data']) {
              w.line(`<x:String>${ns}</x:String>`);
            }
          });
        },
      );
      w.block(
        '<TextExpression.ReferencesForImplementation>',
        '</TextExpression.ReferencesForImplementation>',
        () => {
          w.block('<sco:Collection x:TypeArguments="AssemblyReference">', '</sco:Collection>', () => {
            for (const assembly of ['mscorlib', 'System', 'System.Core', 'System.Data']) {
              w.line(`<AssemblyReference>${assembly}</AssemblyReference>`);
            }
          });
        },
      );
      emitActivity(w, doc.body);
    },
  );
  return w.toString();
}
