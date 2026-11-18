import 'catalog_item.dart';

/// A failed assistant request, with a message that can be shown as is.
class AssistantException implements Exception {
  const AssistantException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// One turn in a NEXO Assistant conversation.
class AssistantMessage {
  const AssistantMessage(
      {required this.role, required this.content, this.items = const []});

  /// `user` or `assistant`.
  final String role;
  final String content;

  /// Titles the assistant mentioned, shown as tappable cards.
  final List<CatalogItem> items;

  bool get fromUser => role == 'user';

  Map<String, dynamic> toJson() => {'role': role, 'content': content};

  /// Parses the API's `{reply, items}` answer.
  static AssistantMessage fromReply(Map<String, dynamic> json) =>
      AssistantMessage(
        role: 'assistant',
        content: '${json['reply'] ?? ''}'.trim(),
        items: (json['items'] as List? ?? const <dynamic>[])
            .whereType<Map<dynamic, dynamic>>()
            .map(
                (item) => CatalogItem.fromJson(Map<String, dynamic>.from(item)))
            .where((item) => item.id.isNotEmpty)
            .toList(),
      );
}
