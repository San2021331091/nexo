import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/catalog_item.dart';
import 'package:nexo/domain/repositories/catalog_repository.dart';
import 'package:nexo/features/catalog/catalog_cubit.dart';
import 'package:nexo/features/live/live_page.dart';
import 'package:nexo/features/search/section_search_page.dart';
import 'package:nexo/features/shared/widgets.dart';

const _results = [
  CatalogItem(
      id: 'c1',
      slug: 't-sports',
      name: 'T Sports',
      category: 'Sports',
      type: 'channel'),
  CatalogItem(
      id: 'c2',
      slug: 'atn',
      name: 'ATN News',
      category: 'News',
      type: 'channel'),
  CatalogItem(
      id: 'v1',
      slug: 'yt-1',
      name: 'Cricket highlights',
      category: 'ICC',
      type: 'video',
      section: 'sports'),
  CatalogItem(
      id: 'm1',
      slug: 'm',
      name: 'Cricket Movie',
      category: 'Movie',
      type: 'movie'),
  CatalogItem(
      id: 's1',
      slug: 's',
      name: 'Cricket Drama',
      category: 'Series',
      type: 'series',
      language: 'hi'),
];

class _Repository implements CatalogRepository {
  final queries = <String>[];
  @override
  Future<List<CatalogItem>> search(String query) async {
    queries.add(query);
    return _results;
  }

  @override
  Future<List<CatalogItem>> saved() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The titles of the result rows on screen.
List<String> _rows(WidgetTester tester) => [
      for (final row in tester.widgetList<MediaRow>(find.byType(MediaRow)))
        row.item.name
    ];

Future<_Repository> _open(WidgetTester tester, String? section) async {
  final repository = _Repository();
  await tester.pumpWidget(BlocProvider(
      create: (_) => CatalogCubit(repository),
      child: MaterialApp(home: SectionSearchPage(section: section))));
  await tester.enterText(find.byType(TextField), 'cricket');
  await tester.pump(const Duration(milliseconds: 450));
  await tester.pumpAndSettle();
  return repository;
}

void main() {
  testWidgets('Sports search shows only sports channels and videos',
      (tester) async {
    final repository = await _open(tester, 'Sports');
    expect(repository.queries, ['cricket']);
    expect(_rows(tester), ['T Sports', 'Cricket highlights']);
    expect(find.text('2 results in Sports'), findsOneWidget);
  });

  testWidgets('Dramas search shows only dramas', (tester) async {
    await _open(tester, 'Dramas');
    expect(_rows(tester), ['Cricket Drama']);
  });

  testWidgets('search without a section shows everything', (tester) async {
    await _open(tester, null);
    expect(find.text('5 results'), findsOneWidget);
  });

  test('Live TV filters channels by name, category and description', () {
    const channels = [
      CatalogItem(
          id: '1',
          slug: 'a',
          name: 'T Sports',
          category: 'Sports',
          type: 'channel',
          synopsis: 'Cricket and football from Bangladesh'),
      CatalogItem(
          id: '2',
          slug: 'b',
          name: 'ATN News',
          category: 'News',
          type: 'channel'),
    ];
    expect(filterChannels(channels, query: 'news').map((c) => c.id), ['2']);
    expect(
        filterChannels(channels, query: 'cricket bangladesh').map((c) => c.id),
        ['1']);
    expect(filterChannels(channels, query: 'SPORTS').map((c) => c.id), ['1']);
    expect(
        filterChannels(channels, category: 'News', query: 'sports'), isEmpty);
    expect(filterChannels(channels).length, 2);
  });
}
