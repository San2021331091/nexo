import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/catalog_item.dart';
import 'package:nexo/features/discover/discover_page.dart';

CatalogItem _item(String type,
        {String category = '',
        String language = '',
        List<String> genres = const [],
        String? section}) =>
    CatalogItem(
        id: '$type-$category-$language',
        slug: 'x',
        name: 'x',
        category: category,
        type: type,
        language: language,
        genres: genres,
        section: section);

void main() {
  test('Discover files each result under its category', () {
    expect(
        discoverSection(_item('channel', category: 'News')), 'Live Channels');
    expect(discoverSection(_item('channel', category: 'Sports')), 'Sports');
    expect(discoverSection(_item('video', category: 'FIFA')), 'Sports');
    expect(discoverSection(_item('movie')), 'Movies');
    expect(discoverSection(_item('series', language: 'en', genres: ['Drama'])),
        'Web Series');
    expect(discoverSection(_item('series', language: 'ko')), 'Dramas');
    expect(discoverSection(_item('series', language: 'Bangla')), 'Dramas');
    expect(discoverSection(_item('series', language: 'en', genres: ['Soap'])),
        'Dramas');
  });

  test('the API section tag wins over the item type', () {
    expect(discoverSection(_item('video', section: 'dramas')), 'Dramas');
    expect(discoverSection(_item('video', section: 'series')), 'Web Series');
    expect(discoverSection(_item('video', section: 'movies')), 'Movies');
    expect(discoverSection(_item('video', section: 'sports')), 'Sports');
    expect(
        CatalogItem.fromJson(
            {'id': 'yt-1', 'type': 'video', 'section': 'dramas'}).section,
        'dramas');
  });
}
