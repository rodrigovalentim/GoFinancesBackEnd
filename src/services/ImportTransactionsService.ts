import { getCustomRepository, getRepository, Not, In } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';
import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categorriesRepository = getRepository(Category);

    const contactReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2,
    });
    const parseCSV = contactReadStream.pipe(parsers);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    await parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });
    await new Promise(resolve => parseCSV.on('end', resolve));

    const existentCategories = await categorriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    const addCategoryTitles = categories
      // Filtra as categorias que nao existem no banco
      .filter(category => !existentCategoriesTitles.includes(category))
      // Filtra as duplicidades, deixando só uma
      .filter((value, index, self) => self.indexOf(value) === index);

    const newCategories = categorriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categorriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransactions = transactionsRepository.create(
      transactions.map(trans => ({
        title: trans.title,
        type: trans.type,
        value: trans.value,
        category: finalCategories.find(
          category => category.title === trans.category,
        ),
      })),
    );

    await transactionsRepository.save(createdTransactions);
    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
